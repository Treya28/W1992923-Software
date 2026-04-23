My program consist of a browser extension for Google Chrome, and a Python server.

1. Open Google Chrome 

2. Click on 'extensions' (puzzle icon in top right corner)

3. Then, open 'manage extensions'

3. Then, 'Load unpacked'
  
5. Browse for 'AIAcademicAssistantExtension' and select which will add it under 'ALL extensions'

6. Ensure 'AI Tool Recommender is enabled using the blue toggle.

7. The extention should be active and the icon displayed in the top right-hand corner. It should appear when the active tab is a predefined general AI website and can also be opened by clicking on the icon.


Notes for running unhosted:
1. In bash terminal to execute python server: go to backend directory, activate the enviroment (venv) and run server.py:
    ./start_server.sh

2. To test if backend server is running: 'http://localhost:7700/health'
    if running, status will return 'healthy'
    
3. To deactivate the enviroment: 
    Type 'deactivate'

4. Change terminal shell to bash:
    chsh -s /bin/bash

5. To confirm what type of terminal shell:
    echo $shell

