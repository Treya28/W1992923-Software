#!/bin/bash
echo "Setting up your local environment from the parent directory ..."
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
echo "Setup complete! Run 'python start_server.sh' to start."