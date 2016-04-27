/*
 * Dog Bed Weight Scale
 * 
 * Evolving.  This is currently more of a test Sketch
 * than what the scale will need to be.
 * 
 * Parts:
 * - 4 load sensors
 * - 4 Load Cell Amplifier boards (HX711)
 * - 1 Arduino Uno
 */

#include "HX711.h"

/*
 * I/O pins:
 *
 * PIN_HX711_LL_* = CLock and Data pins for the Lower Left Amplifier.
 *    Lower Left as you look down on the scale.
 * PIN_HX711_LR_* = same for Lower Right
 */
const int PIN_HX711_LL_CLK = 2;
const int PIN_HX711_LL_DOUT = 3;
const int PIN_HX711_LR_CLK = 4;
const int PIN_HX711_LR_DOUT = 5;

/*
 * LL_OFFSET = zero-load offset for the Lower Left Load Sensor,
 *   calculated from multiple measurements.
 * LL_SCALE = scale from Amplifier units to kg.
 * 
 * LR_* = Same for Lower Right Load Sensor
 */
 
const long LL_OFFSET = 260249L;
const float LL_SCALE = 10831.330;
 
const long LR_OFFSET = 260249L;
const float LR_SCALE = 10831.330;

HX711 llHx711(PIN_HX711_LL_DOUT, PIN_HX711_LL_CLK);
HX711 lrHx711(PIN_HX711_LR_DOUT, PIN_HX711_LR_CLK);

void setup() {
  Serial.begin(9600);
  Serial.println("Raw HX711 output");

  // Once we've calibrated the scale, we want to load those calibrations
  // into each Amplifier object.
  
  llHx711.set_scale(LL_SCALE);
  llHx711.set_offset(LL_OFFSET);
  
  lrHx711.set_scale(LR_SCALE);
  lrHx711.set_offset(LR_OFFSET);

}

void loop() {
  // For now we're testing and calibrating, so just read the raw value.
  float value = lrHx711.read();
  Serial.println(value, 5);
  delay(2000);
}
