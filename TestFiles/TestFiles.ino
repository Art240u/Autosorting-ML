
void setup() {
  Serial.begin(9600);
  pinMode(33, OUTPUT);
  digitalWrite(33, LOW);
}
void loop() 
{
  delay(6000);
  Serial.println("on");
  digitalWrite(33, LOW);
  delay(6000);
  Serial.println("off");
  digitalWrite(33, HIGH); 
}

