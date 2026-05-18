// ---------- DOM элементы ---------------------------------------------------------------------------------------------
const video         = document.getElementById('video');
const overlay       = document.getElementById('overlay');
const overlayCanvas = document.getElementById('overlayCanvas');
const btnStart      = document.getElementById('btnStart');
const btnStop       = document.getElementById('btnStop');
const status        = document.getElementById('status');
const statusText    = document.getElementById('statusText');
const errorMsg      = document.getElementById('errorMsg');
const ctx           = overlayCanvas.getContext('2d');

// ---------- Глобальное состояние -------------------------------------------------------------------------------------
let stream = null;
let model = null;
let isProcessing = false;
let animationId = null;
let frameCounter = 0;

// Настройки детектора
const MODEL_PATH = './model/model.json'; // Путь к папке с моделью
const MODEL_INPUT_SIZE = 640;            // Размер, с которым модель экспортировалась (по умолчанию 640)
const CONF_THRESHOLD = 0.9;             // Минимальная уверенность
const IOU_THRESHOLD  = 0.35;             // Порог NMS (подавление дубликатов)
const NUM_CLASSES    = 1;                // 1 класс: lego
const PROCESS_EVERY  = 3;                // Обрабатывать каждый N-й кадр

// Глобальная переменная для результатов детекции
window.yoloDetections = [];

// Офскрин-канвас для препроцессинга (буквальный размер модели)
const prepCanvas = document.createElement('canvas');
prepCanvas.width = MODEL_INPUT_SIZE;
prepCanvas.height = MODEL_INPUT_SIZE;
const prepCtx = prepCanvas.getContext('2d', { willReadFrequently: false });

// ---------- Загрузка модели TF.js ------------------------------------------------------------------------------------
async function loadModel() {
    if (model) return model;
    try {
        await tf.setBackend('webgl');
        await tf.ready();
        model = await tf.loadGraphModel(MODEL_PATH);
        console.log('✅ YOLOv8 модель загружена');
        return model;
    } catch (err) {
        console.error('❌ Ошибка загрузки модели:', err);
        showError('Не удалось загрузить нейросеть. Проверьте папку /model и убедитесь, что сервер запущен.');
        throw err;
    }
}

// ---------- Запуск камеры и инференса --------------------------------------------------------------------------------
async function startCamera() {
    hideError();
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width:  { ideal: 3265 },
                height: { ideal: 1440 },
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

        // Загружаем модель и запускаем цикл обработки
        await loadModel();
        startInferenceLoop();

    } catch (err) {
        console.error('Ошибка доступа к камере:', err);
        showError(translateError(err));
        status.className = 'status error';
        statusText.textContent = 'Ошибка';
    }
}

// ---------- Остановка камеры и очистка памяти ------------------------------------------------------------------------
function stopCamera() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }
    video.srcObject = null;

    // Останавливаем инференс и очищаем результаты
    stopInferenceLoop();
    window.yoloDetections = [];

    overlay.classList.remove('hidden');
    btnStart.disabled = false;
    btnStop.disabled  = true;
    status.className  = 'status';
    statusText.textContent = 'Камера не активна';
    hideError();
}

// ---------- Цикл обработки кадров ------------------------------------------------------------------------------------
function startInferenceLoop() {
    if (isProcessing) return;
    isProcessing = true;
    frameCounter = 0;
    window.yoloDetections = [];
    processNextFrame();
}

function stopInferenceLoop() {
    isProcessing = false;
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
}

function processNextFrame() {
    if (!isProcessing || video.paused || video.ended) {
        animationId = requestAnimationFrame(processNextFrame);
        return;
    }

    frameCounter++;
    if (frameCounter % PROCESS_EVERY !== 0) {
        animationId = requestAnimationFrame(processNextFrame);
        return;
    }

    const vidW = video.videoWidth;
    const vidH = video.videoHeight;
    if (!vidW || !vidH) {
        animationId = requestAnimationFrame(processNextFrame);
        return;
    }

    // 1. Letterbox-препроцессинг
    const scale = Math.min(MODEL_INPUT_SIZE / vidW, MODEL_INPUT_SIZE / vidH);
    const newW = vidW * scale;
    const newH = vidH * scale;
    const padX = (MODEL_INPUT_SIZE - newW) / 2;
    const padY = (MODEL_INPUT_SIZE - newH) / 2;

    prepCtx.fillStyle = '#808080';
    prepCtx.fillRect(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
    prepCtx.drawImage(video, padX, padY, newW, newH);

    // 2. Инференс
    tf.tidy(() => {
        const inputTensor = tf.browser.fromPixels(prepCanvas)
            .toFloat()
            .div(255.0)
            .expandDims(0);

        const output = model.predict(inputTensor);
        window.yoloDetections = decodeYOLOv8Output(output, vidW, vidH, scale, padX, padY);
    });

    // 3. Отрисовка
    drawDetections(window.yoloDetections);

    animationId = requestAnimationFrame(processNextFrame);
}

// ---------- Декодирование выхода YOLOv8 ------------------------------------------------------------------------------
function decodeYOLOv8Output(outputTensor, origW, origH, scale, padX, padY) {
    // Приводим вывод к формату [N, 4+numClasses]
    let raw = outputTensor.squeeze([0]);
    if (raw.shape[1] > raw.shape[0]) {
        raw = raw.transpose([1, 0]);
    }

    const data = raw.dataSync();
    const numBoxes = raw.shape[0];
    const boxCols = 4 + NUM_CLASSES;
    const boxes = [];

    for (let i = 0; i < numBoxes; i++) {
        const offset = i * boxCols;
        const cx = data[offset];
        const cy = data[offset + 1];
        const w  = data[offset + 2];
        const h  = data[offset + 3];

        // Находим класс с максимальной уверенностью
        let maxConf = 0;
        let classId = -1;
        for (let c = 0; c < NUM_CLASSES; c++) {
            const conf = data[offset + 4 + c];
            if (conf > maxConf) {
                maxConf = conf;
                classId = c;
            }
        }

        if (maxConf < CONF_THRESHOLD) continue;

        // Конвертируем center-wh в x1y1x2y2 в координатах модели
        let x1 = cx - w / 2, y1 = cy - h / 2;
        let x2 = cx + w / 2, y2 = cy + h / 2;

        // Обратное преобразование к оригинальному разрешению
        const origX1 = (x1 - padX) / scale;
        const origY1 = (y1 - padY) / scale;
        const origX2 = (x2 - padX) / scale;
        const origY2 = (y2 - padY) / scale;

        // Ограничиваем рамками кадра
        const clampedX1 = Math.max(0, Math.min(origW, origX1));
        const clampedY1 = Math.max(0, Math.min(origH, origY1));
        const clampedX2 = Math.max(0, Math.min(origW, origX2));
        const clampedY2 = Math.max(0, Math.min(origH, origY2));

        boxes.push({
            classId,
            confidence: maxConf,
            className: 'lego',
            topRight:   [clampedX2, clampedY1],
            bottomLeft: [clampedX1, clampedY2]
        });
    }

    return nonMaxSuppression(boxes, IOU_THRESHOLD);
}

// ---------- Отрисовка рамок -----------------------------------------------------------------------------------------
function drawDetections(detections) {
    // Устанавливаем размеры канваса равными размерам видео
    const vidRect = video.getBoundingClientRect();
    overlayCanvas.width = vidRect.width;
    overlayCanvas.height = vidRect.height;

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    detections.forEach(det => {
        const [x1, y1] = det.bottomLeft;
        const [x2, y2] = det.topRight;

        // Масштабируем координаты к размерам отображаемого видео
        const scaleX = ctx.canvas.width / video.videoWidth;
        const scaleY = ctx.canvas.height / video.videoHeight;

        const x1s = x1 * scaleX;
        const y1s = y1 * scaleY;
        const x2s = x2 * scaleX;
        const y2s = y2 * scaleY;
        const width  = x2s - x1s;
        const height = y2s - y1s;

        // Рисуем рамку
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 3;
        ctx.strokeRect(x1s, y1s, width, height);

        // Подпись
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(x1s, y1s - 20, width, 20);
        ctx.font = '14px sans-serif';
        ctx.fillStyle = '#fff';
        ctx.fillText(
            `${det.className} ${(det.confidence * 100).toFixed(1)}%`,
            x1s + 4,
            y1s - 5
        );
    });
}

// ---------- NMS (Подавление дубликатов) ------------------------------------------------------------------------------
function nonMaxSuppression(boxes, iouThreshold) {
    if (boxes.length === 0) return [];
    boxes.sort((a, b) => b.confidence - a.confidence);
    const keep = [];
    const suppress = new Set();

    for (let i = 0; i < boxes.length; i++) {
        if (suppress.has(i)) continue;
        keep.push(boxes[i]);
        const b1 = boxes[i];

        for (let j = i + 1; j < boxes.length; j++) {
            if (suppress.has(j)) continue;
            if (boxes[j].classId !== b1.classId) continue;
            const b2 = boxes[j];

            const xA = Math.max(b1.bottomLeft[0], b2.bottomLeft[0]);
            const yA = Math.max(b1.topRight[1], b2.topRight[1]);
            const xB = Math.min(b1.topRight[0], b2.topRight[0]);
            const yB = Math.min(b1.bottomLeft[1], b2.bottomLeft[1]);

            const interW = Math.max(0, xB - xA);
            const interH = Math.max(0, yB - yA);
            const interArea = interW * interH;
            const area1 = (b1.topRight[0] - b1.bottomLeft[0]) * (b1.bottomLeft[1] - b1.topRight[1]);
            const area2 = (b2.topRight[0] - b2.bottomLeft[0]) * (b2.bottomLeft[1] - b2.topRight[1]);
            const unionArea = area1 + area2 - interArea;

            if (unionArea === 0) continue;
            if ((interArea / unionArea) > iouThreshold) suppress.add(j);
        }
    }
    return keep;
}

// ---------- Вспомогательные функции ----------------------------------------------------------------------------------
function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.classList.add('visible');
}
function hideError() {
    errorMsg.classList.remove('visible');
}
function translateError(err) {
    switch (err.name) {
        case 'NotAllowedError': return 'Доступ к камере запрещён. Разрешите в настройках браузера.';
        case 'NotFoundError': return 'Камера не найдена на этом устройстве.';
        case 'NotReadableError': return 'Камера занята другим приложением.';
        case 'OverconstrainedError': return 'Камера не поддерживает запрошенные параметры.';
        case 'SecurityError': return 'Ошибка безопасности. Используйте HTTPS.';
        default: return `Ошибка: ${err.message}`;
    }
}

// ---------- Обработчики кнопок ---------------------------------------------------------------------------------------
btnStart.addEventListener('click', startCamera);
btnStop.addEventListener('click', stopCamera);