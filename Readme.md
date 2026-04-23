This program consist of a browser extension for Google Chrome, and a Python server.

Notes for running bakend hosted on Hugging Faces -----------------------------------

1. Open Google Chrome 

2. Click on 'extensions' (puzzle icon in top right corner)

3. Then, open 'manage extensions'

3. Then, 'Load unpacked'
  
5. Browse for 'AIAcademicAssistantExtension' and select which will add it under 'ALL extensions'

6. Ensure 'AI Tool Recommender is enabled using the blue toggle.

7. The extention should be active and the icon displayed in the top right-hand corner. It should appear when the active tab is a predefined general AI website and can also be opened by clicking on the icon.

8. Call the 'https://w19929235-fyp.hf.space/health' to ensure the backend is running and awake, before exectuting taaks inputs. Without this the gemini response may time out and not display.


Notes if running backend unhosted ----------------------------------------------
If running the the browser extension on the local server:

1. Change terminal shell to bash:
    chsh -s /bin/bash

2. To confirm what type of terminal shell:
    echo $shell

3. Create '.env' file in the backend. 
This file is to contain the Gemini API Key. It has been removed the repository, due to previously becoming comprimised and disabled by Google Gemini. A new key is now used and included in the Final year Report (Appendix 2) and last submission's text.
An '.env' file must be created in the backend folder, and the 'GEMINI_API_KEY' pasted as provided (without '').

4. Ensure the enviroment is active: Requires navigation to backend directory,   activate the enviroment (venv) and run server.py. 
These steps are are all exectured using the folowing command in the bash terminal:
    Type: './start_server.sh'

5. Update the endpoint URLs (/analyse, /analyse-llm and /health) have been to rather include 'http://localhost:7700' in the files: 
    server.py, background.js and popup.js

6. To test if backend server is running: 'http://localhost:7700/health'
    if running, status will return 'healthy'
    
7. To deactivate the enviroment: 
    Type: 'deactivate'


