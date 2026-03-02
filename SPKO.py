import cv2
import keyboard
import time
import os
import chime

# --- Константы и конфигурация ---
CONFIG_FILENAME = 'face_pos.txt'
FACE_MODEL_PATH = 'opencv_face_detector_uint8.pb'
FACE_PROTO_PATH = 'opencv_face_detector.pbtxt'
CONFIDENCE_THRESHOLD = 0.7
ALERT_COOLDOWN_SECONDS = 2
HOTKEY_COMBINATION = 'shift+p+g'

# --- Глобальные состояния ---
# Путь к файлу конфигурации относительно скрипта
script_dir = os.path.dirname(__file__)
config_file_path = os.path.join(script_dir, CONFIG_FILENAME)

# Текущее значение для сохранения (используется в callback горячей клавиши)
current_save_value = 0

# Время последнего звукового уведомления (для cooldown)
last_alert_time = 0

def load_threshold():
    """Загружает пороговое значение позиции из файла."""
    try:
        with open(config_file_path, 'r') as f:
            return int(f.read().strip())
    except (FileNotFoundError, ValueError):
        return 0

def save_threshold(value):
    """Сохраняет пороговое значение позиции в файл."""
    with open(config_file_path, 'w') as f:
        f.write(str(value))

def on_save_hotkey():
    """Callback для горячей клавиши: сохраняет текущую рассчитанную позицию."""
    global current_save_value
    save_threshold(current_save_value)
    print(f"Позиция сохранена: {current_save_value}")

def detect_faces(net, frame):
    """Обнаруживает лица на кадре и возвращает кадр с прямоугольниками и координаты."""
    frame_height = frame.shape[0]
    frame_width = frame.shape[1]
    
    blob = cv2.dnn.blobFromImage(frame, 1.0, (300, 300), [104, 117, 123], True, False)
    net.setInput(blob)
    detections = net.forward()
    
    faces = []
    for i in range(detections.shape[2]):
        confidence = detections[0, 0, i, 2]
        if confidence > CONFIDENCE_THRESHOLD:
            x1 = int(detections[0, 0, i, 3] * frame_width)
            y1 = int(detections[0, 0, i, 4] * frame_height)
            x2 = int(detections[0, 0, i, 5] * frame_width)
            y2 = int(detections[0, 0, i, 6] * frame_height)
            faces.append([x1, y1, x2, y2])
            cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), int(round(frame_height / 150)), 8)

    return frame, faces

def main():
    global current_save_value, last_alert_time
    
    # Загрузка модели
    face_net = cv2.dnn.readNet(FACE_MODEL_PATH, FACE_PROTO_PATH)
    video_capture = cv2.VideoCapture(0)
    
    # Загрузка порога
    threshold_y = load_threshold()
    
    # Регистрация горячей клавиши (вне цикла)
    keyboard.add_hotkey(HOTKEY_COMBINATION, on_save_hotkey)
    
    print(f"Нажмите 'q' для выхода. Горячая клавиша сохранения: {HOTKEY_COMBINATION}")

    while True:
        has_frame, frame = video_capture.read()
        if not has_frame:
            break
            
        # Обработка кадра
        result_frame, faces = detect_faces(face_net, frame)
        
        if faces:
            # Берем Y-координату первого найденного лица
            face_y_position = faces[0][1]
            
            # Подготовка значения для сохранения (логика из оригинала: pos + 7)
            current_save_value = str(face_y_position + 1)
            
            # Проверка осанки/позиции (если лицо ниже порога)
            is_posture_bad = face_y_position >= threshold_y
            
            if is_posture_bad:
                current_time = time.time()
                # Проверка cooldown без блокировки потока (вместо time.sleep)
                if current_time - last_alert_time >= ALERT_COOLDOWN_SECONDS:
                    chime.success()
                    last_alert_time = current_time
                    print("Внимание: неправильная позиция!")
        
        # Отображение результата
        resultframe = cv2.line(result_frame,(0,threshold_y),(1000,threshold_y),(255,0,0),3)
        cv2.imshow('Face Detection', resultframe)
        
        # Выход по клавише 'q'
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    video_capture.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    main()
