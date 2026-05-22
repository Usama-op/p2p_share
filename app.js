// PWA Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('SW Registered'))
            .catch(err => console.error('SW Failed', err));
    });
}

const CONFIG = {
    CHUNK_SIZE: 64 * 1024, // 64KB
    MAX_BUFFER: 4 * 1024 * 1024, // 4MB
    ICE_SERVERS: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:stun.services.mozilla.com' },
        { urls: 'stun:stun.stunprotocol.org:3478' }
    ],
    RECONNECT_DELAY: 1000,
    MAX_RECONNECT_ATTEMPTS: 5
};

// UI Elements
const myIdDisplay = document.getElementById('my-id');
const peerIdInput = document.getElementById('peer-id-input');
const connectBtn = document.getElementById('connect-btn');
const connectionStatus = document.getElementById('connection-status');
const transferSection = document.getElementById('transfer-section');
const fileInput = document.getElementById('file-input');
const fileNameDisplay = document.getElementById('file-name');
const sendBtn = document.getElementById('send-btn');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const transferSpeed = document.getElementById('transfer-speed');
const transferInfo = document.getElementById('transfer-info');
const dropZone = document.getElementById('drop-zone');
const historyList = document.getElementById('history-list');
const copyIdBtn = document.getElementById('copy-id-btn');
const shareIdBtn = document.getElementById('share-id-btn');
const showQrBtn = document.getElementById('show-qr-btn');
const scanQrBtn = document.getElementById('scan-qr-btn');
const qrModal = document.getElementById('qr-modal');
const scannerModal = document.getElementById('scanner-modal');
const closeModals = document.querySelectorAll('.close-modal');
const installBtn = document.getElementById('pwa-install-btn');

class FileTransferManager {
    constructor() {
        this.reset();
    }

    reset() {
        this.activeTransfer = null;
        this.receivedChunks = [];
        this.totalChunks = 0;
        this.fileMeta = null;
        this.startTime = 0;
        this.bytesTransferred = 0;
        if (transferInfo) transferInfo.classList.add('hidden');
    }

    async sendFile(file, connection) {
        if (this.activeTransfer) return;
        this.activeTransfer = true;
        this.startTime = Date.now();
        this.bytesTransferred = 0;

        const metadata = {
            type: 'meta',
            name: file.name,
            size: file.size,
            fileType: file.type || 'application/octet-stream'
        };

        connection.send(metadata);
        addHistoryItem(`Sending: ${file.name}`, 'pending');

        const reader = file.stream().getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            for (let i = 0; i < value.length; i += CONFIG.CHUNK_SIZE) {
                const chunk = value.slice(i, i + CONFIG.CHUNK_SIZE);
                
                if (connection.dataChannel && connection.dataChannel.bufferedAmount > CONFIG.MAX_BUFFER) {
                    await new Promise(resolve => {
                        const check = setInterval(() => {
                            if (connection.dataChannel.bufferedAmount < CONFIG.MAX_BUFFER / 4) {
                                clearInterval(check);
                                resolve();
                            }
                        }, 50);
                    });
                }

                connection.send({ type: 'chunk', content: chunk });
                this.bytesTransferred += chunk.length;
                this.updateProgress(file.size);
            }
        }

        this.activeTransfer = false;
        showToast(`Sent ${file.name}`);
        finalizeHistoryItem(file.name, 'Sent', true);
        this.reset();
    }

    handleIncoming(data, connection) {
        if (data.type === 'meta') {
            this.reset();
            this.fileMeta = data;
            this.totalChunks = Math.ceil(data.size / CONFIG.CHUNK_SIZE);
            this.startTime = Date.now();
            
            transferInfo.classList.remove('hidden');
            fileNameDisplay.innerText = `Receiving: ${data.name}`;
            showProgress(0);
            addHistoryItem(`Receiving: ${data.name}`, 'pending');
        } else if (data.type === 'chunk') {
            this.receivedChunks.push(data.content);
            this.bytesTransferred += data.content.byteLength;
            
            this.updateProgress(this.fileMeta.size);

            if (this.receivedChunks.length === this.totalChunks) {
                const blob = new Blob(this.receivedChunks, { type: this.fileMeta.fileType });
                const url = URL.createObjectURL(blob);
                finalizeTransfer(this.fileMeta.name, url);
                
                const a = document.createElement('a');
                a.href = url;
                a.download = this.fileMeta.name;
                a.click();
                
                showToast(`Received ${this.fileMeta.name}`);
                this.reset();
            }
        }
    }

    updateProgress(totalSize) {
        const percent = Math.round((this.bytesTransferred / totalSize) * 100);
        const duration = (Date.now() - this.startTime) / 1000;
        const speed = duration > 0 ? this.bytesTransferred / duration : 0;
        
        showProgress(percent, speed, totalSize - this.bytesTransferred);
    }
}

const transferManager = new FileTransferManager();

// EASY ID GENERATION
function generateEasyId() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

let myId = generateEasyId();
let peer = null;
let conn = null;
let reconnectAttempts = 0;

function initPeer() {
    if (peer) peer.destroy();
    
    peer = new Peer(myId, {
        config: { 'iceServers': CONFIG.ICE_SERVERS, 'sdpSemantics': 'unified-plan' },
        debug: 1
    });

    peer.on('open', (id) => {
        myIdDisplay.innerText = id;
        reconnectAttempts = 0;
        showStatus('Online', 'connected');
    });

    peer.on('connection', setupConnection);

    peer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
            myId = generateEasyId();
            setTimeout(initPeer, 500);
        } else if (err.type === 'network' || err.type === 'server-error') {
            handleReconnect();
        }
        showStatus(`Error: ${err.type}`, 'error');
    });

    peer.on('disconnected', () => {
        showStatus('Reconnecting...', 'error');
        handleReconnect();
    });
}

function handleReconnect() {
    if (reconnectAttempts < CONFIG.MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        const delay = CONFIG.RECONNECT_DELAY * Math.pow(2, reconnectAttempts - 1);
        setTimeout(() => {
            if (peer && peer.disconnected) peer.reconnect();
            else if (!peer || peer.destroyed) initPeer();
        }, delay);
    }
}

function setupConnection(connection) {
    if (conn) conn.close();
    conn = connection;
    
    conn.on('open', () => {
        showStatus('Connected', 'connected');
        showToast('Peer connected');
        transferSection.classList.remove('hidden');
        scannerModal.classList.add('hidden');
        cleanupScanner();
    });

    conn.on('data', (data) => transferManager.handleIncoming(data, conn));

    conn.on('close', () => {
        showStatus('Online', 'connected');
        showToast('Connection closed');
        transferSection.classList.add('hidden');
        transferManager.reset();
        conn = null;
    });
}

// UI Helpers
function showStatus(text, type) {
    connectionStatus.innerText = text;
    connectionStatus.className = `status ${type}`;
}

function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerText = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'], i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '--';
    if (seconds < 60) return Math.round(seconds) + 's';
    return Math.floor(seconds / 60) + 'm ' + Math.round(seconds % 60) + 's';
}

function showProgress(percent, speed = 0, remainingBytes = 0) {
    progressContainer.classList.remove('hidden');
    progressBar.style.width = `${percent}%`;
    progressText.innerText = `${percent}%`;
    if (speed > 0) {
        transferSpeed.innerText = `${formatBytes(speed)}/s • ${formatTime(remainingBytes / speed)} left`;
    }
}

function addHistoryItem(name, status, url = null) {
    const list = historyList;
    if (list.querySelector('.empty-state')) list.innerHTML = '';
    
    const li = document.createElement('li');
    li.innerHTML = `<span>${name}</span> <span class="status-tag">${status}</span>`;
    if (url) {
        const a = document.createElement('a');
        a.href = url; a.download = name; a.innerText = 'Save'; a.className = 'download-link';
        li.appendChild(a);
    }
    list.prepend(li);
}

function finalizeHistoryItem(name, status, success = true) {
    const items = historyList.querySelectorAll('li');
    for (let item of items) {
        if (item.innerText.includes(name)) {
            const tag = item.querySelector('.status-tag');
            if (tag) { tag.innerText = status; if (success) tag.style.color = 'var(--success)'; }
            break;
        }
    }
}

function finalizeTransfer(name, url) {
    const items = Array.from(historyList.querySelectorAll('li'));
    const target = items.find(li => li.innerText.includes(name));
    if (target) {
        target.innerHTML = `<span>${name}</span> <a href="${url}" download="${name}" class="download-link">Save File</a>`;
    }
}

// Event Listeners
connectBtn.addEventListener('click', () => {
    const id = peerIdInput.value.trim();
    if (id && id !== peer.id) setupConnection(peer.connect(id, { reliable: true }));
});

copyIdBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(myIdDisplay.innerText).then(() => {
        showToast('ID Copied');
        const icon = copyIdBtn.innerText; copyIdBtn.innerText = '✅';
        setTimeout(() => copyIdBtn.innerText = icon, 2000);
    });
});

shareIdBtn.addEventListener('click', () => {
    if (navigator.share) {
        navigator.share({ title: 'P2P Share ID', text: `Connect with me: ${myIdDisplay.innerText}`, url: window.location.href });
    } else {
        copyIdBtn.click();
    }
});

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        transferInfo.classList.remove('hidden');
        fileNameDisplay.innerText = file.name;
        sendBtn.disabled = false;
        transferSpeed.innerText = formatBytes(file.size);
    }
});

sendBtn.addEventListener('click', async () => {
    const file = fileInput.files[0];
    if (file && conn) {
        sendBtn.disabled = true;
        await transferManager.sendFile(file, conn);
        sendBtn.disabled = false;
    }
});

// Drag and Drop
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
    dropZone.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); });
});
dropZone.addEventListener('dragover', () => dropZone.classList.add('dragover'));
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
    dropZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) {
        fileInput.files = e.dataTransfer.files;
        fileInput.dispatchEvent(new Event('change'));
    }
});

// QR Code
showQrBtn.addEventListener('click', () => {
    qrModal.classList.remove('hidden');
    const qrContainer = document.getElementById('qrcode');
    qrContainer.innerHTML = '';
    new QRCode(qrContainer, { text: peer.id, width: 200, height: 200, colorDark: "#1e293b" });
});

let html5QrCode = null;
scanQrBtn.addEventListener('click', () => {
    scannerModal.classList.remove('hidden');
    html5QrCode = new Html5Qrcode("reader");
    html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, (text) => {
        peerIdInput.value = text;
        cleanupScanner().then(() => { scannerModal.classList.add('hidden'); connectBtn.click(); });
    });
});

async function cleanupScanner() {
    if (html5QrCode && html5QrCode.isScanning) {
        await html5QrCode.stop();
        document.getElementById('reader').innerHTML = '';
    }
}

closeModals.forEach(btn => btn.addEventListener('click', () => {
    qrModal.classList.add('hidden');
    scannerModal.classList.add('hidden');
    cleanupScanner();
}));

// PWA Install
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); deferredPrompt = e;
    if (installBtn) installBtn.classList.remove('hidden');
});
if (installBtn) installBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
        installBtn.classList.add('hidden');
    }
});

initPeer();
