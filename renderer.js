const { ipcRenderer } = require('electron');

let isPaused = false;
let isRunning = false;
let autoScroll = true;
const logDiv = document.querySelector('.logs');

function addToLog(message) {
    console.log("Adding log entry:", message);
    const newMessage = document.createElement('div');
    newMessage.className = 'log-entry';
    newMessage.textContent = `${new Date().toLocaleTimeString()} - ${message}`;
    logDiv.appendChild(newMessage);

    if (autoScroll) {
        logDiv.scrollTop = logDiv.scrollHeight;
    }
}

function initializeScrollListener() {
    logDiv.addEventListener('scroll', () => {
        const atBottom = logDiv.scrollTop + logDiv.clientHeight >= logDiv.scrollHeight - 5; 
        autoScroll = atBottom;
    });
}

function updateButtonStates() {
    const startButton = getElement('start-button');
    const pauseButton = getElement('pause-button');
    const stopButton = getElement('stop-button');

    startButton.textContent = isPaused ? 'Resumir' : 'Iniciar';
    toggleButtonState(startButton, !isRunning || isPaused);
    toggleButtonState(pauseButton, isRunning && !isPaused);
    toggleButtonState(stopButton, isRunning);
}

function toggleButtonState(button, isEnabled) {
    button.disabled = !isEnabled;
    button.classList.toggle('disabled-button', !isEnabled);
}

function getElement(id) {
    return document.getElementById(id);
}

function showError(message) {
    addToLog(`Error: ${message}`);
    alert(message);
}

function handleStartButton() {
    if (isPaused) {
        ipcRenderer.send('resume');
        isPaused = false;
    } else {
        const useProxies = getElement('use-proxies').checked;
        const useHeadless = getElement('headless-mode').checked;
        const retryOnFail = getElement('retry-on-fail').checked;
        const humanizedMode = getElement('humanized-mode').checked;
        const numWorkers = parseInt(getElement('num-workers').value, 10);
        const credentialsPath = getElement('credentials-path').textContent;
        const proxiesPath = useProxies ? getElement('proxies-path').textContent : null;

        if (credentialsPath === 'No se seleccionó ningún archivo de credenciales.') {
            showError('Por favor, selecciona un archivo de credenciales.');
            return;
        }
        if (useProxies && proxiesPath === 'No se seleccionó ningún archivo de proxies.') {
            showError('Por favor, selecciona un archivo de proxies.');
            return;
        }

        ipcRenderer.send('start', { useProxies, useHeadless, retryOnFail, numWorkers, humanizedMode, credentialsPath, proxiesPath });
        isRunning = true;
    }
    updateButtonStates();

    initializeScrollListener();
}

function handleStopButton() {
    ipcRenderer.send('stop');
    isPaused = false;
    isRunning = false;
    updateButtonStates();
}

function handlePauseButton() {
    ipcRenderer.send('pause');
    isPaused = true;
    updateButtonStates();
}

function updateStats({ hits, bans, invalids }) {
    getElement('hits').innerText = hits;
    getElement('bans').innerText = bans;
    getElement('invalids').innerText = invalids;

    const total = hits + bans + invalids;

    if (total > 0) {
        getElement('hitProgress').style.width = `${(hits / total) * 100}%`;
        getElement('banProgress').style.width = `${(bans / total) * 100}%`;
        getElement('invalidProgress').style.width = `${(invalids / total) * 100}%`;
    }
}

function handleSelectCredentials() {
    ipcRenderer.send('select-credentials');
}

function handleSelectProxies() {
    ipcRenderer.send('select-proxies');
}

function handleSelectedCredentials(event, filePath) {
    getElement('credentials-path').textContent = filePath || 'No se seleccionó ningún archivo de credenciales.';
}

function handleSelectedProxies(event, filePath) {
    getElement('proxies-path').textContent = filePath || 'No se seleccionó ningún archivo de proxies.';
}

function initializeApp() {
    getElement('start-button').addEventListener('click', handleStartButton);
    getElement('stop-button').addEventListener('click', handleStopButton);
    getElement('pause-button').addEventListener('click', handlePauseButton);
    getElement('select-credentials').addEventListener('click', handleSelectCredentials);
    getElement('select-proxies').addEventListener('click', handleSelectProxies);

    ipcRenderer.on('log-message', (event, message) => addToLog(message));
    ipcRenderer.on('update-stats', (event, stats) => updateStats(stats));
    ipcRenderer.on('selected-credentials', handleSelectedCredentials);
    ipcRenderer.on('selected-proxies', handleSelectedProxies);

    updateButtonStates();
}

document.addEventListener('DOMContentLoaded', initializeApp);
