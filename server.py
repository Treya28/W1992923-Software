from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
import json
import os
import re as _re # for JSON response cleaning

_env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
load_dotenv(_env_path)
print(f"[startup] Loading .env from: {_env_path}")
print(f"[startup] GEMINI_API_KEY loaded: {'yes' if os.environ.get('GEMINI_API_KEY') else 'NO — key not found!'}")

try:
    from google import genai
    GEMINI_AVAILABLE = True
    print("[startup] google-genai package: OK")
except ImportError:
    GEMINI_AVAILABLE = False
    print("[startup] google-genai package: NOT INSTALLED")

app = Flask(__name__)
CORS(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Load tools database — looks for tools.json in the extension root (one level up)
def loadTools():
    # Try two possible locations for tools.json — the extension root first, then the current folder
    for path in [os.path.join(BASE_DIR, '..', 'tools.json'), 'tools.json']:
        try:
            with open(path, 'r') as f:
                data = json.load(f)['tools']  # pull out just the 'tools' array from the file
                print(f"[startup] Loaded {len(data)} tools from: {os.path.abspath(path)}")
                return data
        except Exception:
            continue  # file not found or invalid — try the next path
    # Neither path worked, so return fallback so the server can still start
    print("[startup] WARNING: tools.json not found, using fallback single-tool list")
    return [
        {
            "id": 1,
            "name": "ChatGPT",
            "description": "General-purpose AI assistant",
            "url": "https://chat.openai.com",
            "categories": ["general"]
        }
    ]

tools = loadTools()


# Score every tool against the task text using categories and tags; return the highest-scoring match.
def analyseTask(task_description):
    """Rule-based keyword classifier driven by categories and tags from tools.json."""
    task_lower = task_description.lower()  # lowercase so comparisons are case-insensitive
    best_tool = None
    best_score = 0

    for tool in tools:
        score = 0
        # Check if any of the tool's categories appear in the task text
        for category in tool.get('categories', []):
            if category.lower() in task_lower:
                score += 2  # categories are more specific, so they count double
        # Check if any of the tool's tags appear in the task text
        for tag in tool.get('tags', []):
            if tag.lower() in task_lower:
                score += 1
        # Keep track of whichever tool scored highest so far
        if score > best_score:
            best_score = score
            best_tool = tool

    # Only return a tool if at least one keyword matched, otherwise return nothing
    return best_tool if best_score > 0 else None


# POST /analyse — runs keyword matching only and returns the best tool, or a fallback message.
@app.route('/analyse', methods=['POST'])
def analyse():
    data = request.json
    task = data.get('task', '')  # read the task description sent by the extension

    # Reject the request early if no task was included in the body
    if not task:
        return jsonify({'error': 'No task provided'}), 400

    # Run the keyword-based matcher to find the best tool
    recommended_tool = analyseTask(task)

    if recommended_tool:
        # A match was found - send the tool details back to the extension
        return jsonify({'recommended': True, 'tool': recommended_tool})
    else:
        # No match — tell the caller to fall back to a general AI tool
        return jsonify({'recommended': False, 'message': 'Use general AI tool'})


# POST /analyse-llm — tries keyword matching first, calls Gemini only when no keyword match is found.
@app.route('/analyse-llm', methods=['POST'])
def analyseWithLlm():
    data = request.json
    task = data.get('task', '')  # read the task the student typed
    print(f"\n[/analyse-llm] Received task: '{task}'")

    # Reject the request early if no task was included
    if not task:
        print("[/analyse-llm] ERROR: No task provided")
        return jsonify({'error': 'No task provided'}), 400

    # Cannot proceed if the Gemini library wasn't installed
    if not GEMINI_AVAILABLE:
        print("[/analyse-llm] ERROR: google-genai not installed")
        return jsonify({
            'error': 'google-genai package is not installed. Run: pip install google-genai',
            'configured': False
        }), 503

    # Cannot proceed if the API key is missing from the environment
    api_key = os.environ.get('GEMINI_API_KEY')
    if not api_key:
        print("[/analyse-llm] ERROR: GEMINI_API_KEY not set")
        return jsonify({
            'error': 'GEMINI_API_KEY environment variable is not set.',
            'configured': False
        }), 503

    # Try keyword matching first — only call Gemini if no match found
    keyword_match = analyseTask(task)
    if keyword_match:
        # Keyword match is good enough — skip the Gemini API call to save time
        print(f"[/analyse-llm] Keyword match found: {keyword_match['name']}, skipping Gemini")
        return jsonify({'recommended': True, 'tool': keyword_match, 'source': 'keyword'})

    print("[/analyse-llm] No keyword match, calling Gemini...")

    try:
        # Create a Gemini client using the API key from the environment
        client = genai.Client(api_key=api_key)

        # Build the prompt that tells Gemini exactly what is needed
        prompt = (
            "You are an academic assistant helping university students find the most specialised AI tool available for their task. "
            "A student has described the following task. "
            "Recommend the best suited AI tool for the task. "
            "Do not limit yourself to any specific list of tools. "
            "Respond suggesting one AI Tool; include the tool name and brief, consise descsription with the link to access the tool. "
            " Your response must be in JSON format \n\n"
            f"Task: {task}\n\n"
            "Response:"
        )

        # Send the prompt to Gemini and get its response
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt
        )
        reply = response.text.strip()
        print(f"[/analyse-llm] Gemini replied: '{reply}'")

        # Gemini sometimes wraps JSON in markdown code fences — strip those out first
        json_str = reply
        md_match = _re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', reply)
        if md_match:
            json_str = md_match.group(1)  # extract just the content between the ``

        try:
            parsed = json.loads(json_str)
            # Gemini may use different key names, so check alternatives for each field
            tool = {
                'name': (parsed.get('name') or parsed.get('tool_name') or parsed.get('tool') or 'Unknown'),
                'description': (parsed.get('description') or parsed.get('brief_description') or ''),
                'url': (parsed.get('url') or parsed.get('link') or parsed.get('access_link') or '')
            }
            return jsonify({'recommended': True, 'tool': tool, 'source': 'llm'})
        except (json.JSONDecodeError, AttributeError):
            # If Gemini doesn't return valid JSON — send back the raw text so the UI can still display rather than a blank error
            print("[/analyse-llm] WARNING: could not parse Gemini reply as JSON, returning raw message")
            return jsonify({'recommended': False, 'message': reply, 'source': 'llm'})

    except Exception as e:
        # Something unexpected occurs — log and tell the caller
        print(f"[/analyse-llm] EXCEPTION: {e}")
        return jsonify({'error': str(e), 'recommended': False}), 500


# GET /health — liveness check used by the keep-alive alarm, also reports Gemini key status
@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'healthy',
        'llm_configured': bool(os.environ.get('GEMINI_API_KEY'))
    })


# GET /tools — returns the full tools list so the popup can use it directly if needed
@app.route('/tools', methods=['GET'])
def get_tools():
    return jsonify({'tools': tools})

# default
@app.route('/')
def health_check():
    return "Backend is running!", 200
    
if __name__ == '__main__':
    print("\n[startup] Server starting on https://w19929235-fyp.hf.space:7860\n")
    app.run(host='0.0.0.0', port=7860, debug=True)
