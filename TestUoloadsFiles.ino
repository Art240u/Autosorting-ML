#include <ESP32Servo.h>
#include "LiquidCrystal_I2C.h"
Servo _mainServo;
int _pinServo = 18;
String _command;
#define RXp2 16
#define TXp2 17
LiquidCrystal_I2C Display(0x27, 16, 2);


void setup() {
  Serial.begin(115200);
  Serial1.begin(9600, SERIAL_8N1, RXp2, TXp2);
  Serial2.begin(9600, SERIAL_8N1, RXp2, TXp2);
  _mainServo.attach(_pinServo);
  Display.init();
  Display.backlight();
  //Display.setCursor(1, 0);
 //Display.print("HELLO WORLD!!!");
  //Display.setCursor(5, 1);
  //Display.print("GREAT!");
}

void loop()
{
   if ((Serial1.available() > 0) && (Serial1.find("on")))
   {
      Display.clear();
      Serial.println("ON");
      _mainServo.write(0);
      Display.print("ON ");
   }
   delay(10);
   if ((Serial2.available() > 0) && (Serial2.find("off")))
   {
      Display.clear();
      Serial.println("OFF");
      _mainServo.write(180);
      Display.print("OFF ");
   }
   delay(10);
}
