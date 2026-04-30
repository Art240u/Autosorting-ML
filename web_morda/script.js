const video      = document.getElementById('video');
const overlay    = document.getElementById('overlay');
const btnStart   = document.getElementById('btnStart');
const btnStop    = document.getElementById('btnStop');
const status     = document.getElementById('status');
const statusText = document.getElementById('statusText');
const errorMsg   = document.getElementById('errorMsg');

let stream = null;

// ---------- Запуск камеры ---------------------------------------------------------------------------------------------
async function startCamera() {
    hideError();

    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width:  { ideal: 1920 },
                height: { ideal: 1080 },
                facingMode: 'user'
            },
            audio: false
        });

        video.srcObject = stream;
        overlay.classList.add('hidden');
        btnStart.disabled = true;
        btnStop.disabled  = false;
        status.className  = 'status active';
        statusText.textContent = 'Камера активна';

    } catch (err) {
        console.error('Ошибка доступа к камере:', err);
        showError(translateError(err));
        status.className = 'status error';
        statusText.textContent = 'Ошибка';
    }
}

// ---------- Остановка камеры --------------------------------------------------------------------------------------------
function stopCamera() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }

    video.srcObject = null;
    overlay.classList.remove('hidden');
    btnStart.disabled = false;
    btnStop.disabled  = true;
    status.className  = 'status';
    statusText.textContent = 'Камера не активна';
    hideError();
}

// ---------- Вспомогательные функции --------------------------------------------------------------------------------------
function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.classList.add('visible');
}

function hideError() {
    errorMsg.classList.remove('visible');
}

function translateError(err) {
    switch (err.name) {
        case 'NotAllowedError':
            return 'Доступ к камере запрещён. Разрешите в настройках браузера.';
        case 'NotFoundError':
            return 'Камера не найдена на этом устройстве.';
        case 'NotReadableError':
            return 'Камера занята другим приложением.';
        case 'OverconstrainedError':
            return 'Камера не поддерживает запрошенные параметры.';
        case 'SecurityError':
            return 'Ошибка безопасности. Используйте HTTPS.';
        default:
            return `Ошибка: ${err.message}`;
    }
}

// ---------- Обработчики кнопок ---------------------------------------------------------------------------------------
btnStart.addEventListener('click', startCamera);
btnStop.addEventListener('click', stopCamera);