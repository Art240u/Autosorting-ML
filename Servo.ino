#include<ESP32Servo.h>
Servo myServ;

void setup() 
{
  myServ.attach(18);
  Serial.begin(115200);
}

void loop() 
{
  if(Serial.available())
  {
    int angle = Serial.parseInt();
    myServ.write(angle);
  }
  delay(20);
}
