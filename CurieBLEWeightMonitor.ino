/*
 * Dog Bed Weight Scale
 * 
 * Evolving.  This is currently more of a test Sketch
 * than what the scale will need to be.
 * 
 * Parts:
 * - 4 load sensors
 * - 4 Load Cell Amplifier boards (HX711)
 * - 1 Arduino
 */

#include "HX711.h"

/*
 * CALIBRATE_SCALE = uncomment this line to report raw Load Cell Amplifier values,
 *  for calibration.
 * Comment out this line to run the normal scale software.
 */
#define CALIBRATE_SCALE 1

/*
 * I/O pins:
 *
 * PIN_HX711_UL_* = CLock and Data pins for the Upper Left Amplifier.
 *    Upper Left as you look down on the scale and the Arduino is in
 *    the lower-center.
 * PIN_HX711_LL_* = same for Lower Left
 * PIN_HX711_UR_* = same for Upper Right
 * PIN_HX711_LR_* = same for Lower Right
 */
const int PIN_HX711_UL_CLK = 2;
const int PIN_HX711_UL_DOUT = 3;
const int PIN_HX711_LL_CLK = 4;
const int PIN_HX711_LL_DOUT = 5;
const int PIN_HX711_UR_CLK = 6;
const int PIN_HX711_UR_DOUT = 7;
const int PIN_HX711_LR_CLK = 8;
const int PIN_HX711_LR_DOUT = 9;

//345678901234567892123456789312345678941234567895123456789612345678971234567898

#ifdef CALIBRATE_SCALE
const int SAMPLES_PER_READING = 40;   // number of samples per calibration reading.
float values[SAMPLES_PER_READING];    // individual readings to do statistics on.
#endif

/*
 * UR_OFFSET = zero-load offset for the Upper Right Load Sensor,
 *   calculated from CALIBRATE_SCALE with nothing, not even the top plywood circle,
 *   on the scale.
 * UR_SCALE = scale from Amplifier units to kg.
 *   Calculated from CALIBRATE_SCALE and a spreadsheet. See Calculations.ods
 * 
 * LR_* = Same for Lower Right Load Sensor.
 * etc.
 */

const long UR_OFFSET = 260249L;
const float UR_SCALE = 10831.330;
 
const long LR_OFFSET = 260249L;
const float LR_SCALE = 10831.330;

const long UL_OFFSET = 260249L;
const float UL_SCALE = 10831.330;

const long LL_OFFSET = 260249L;
const float LL_SCALE = 10831.330;

// *Hx711 = controller for each HX711 Load Cell Amplifier
HX711 llHx711(PIN_HX711_LL_DOUT, PIN_HX711_LL_CLK);
HX711 lrHx711(PIN_HX711_LR_DOUT, PIN_HX711_LR_CLK);
HX711 ulHx711(PIN_HX711_UL_DOUT, PIN_HX711_UL_CLK);
HX711 urHx711(PIN_HX711_UR_DOUT, PIN_HX711_UR_CLK);

void setup() {
  Serial.begin(9600);

#ifdef CALIBRATE_SCALE
  Serial.print(F("Calibrating, "));
  Serial.print(SAMPLES_PER_READING);
  Serial.println(F(" Samples per row."));

  Serial.print(F("LL Average,LL Std Dev,"));
  Serial.print(F("UL Average,UL Std Dev,"));
  Serial.print(F("UR Average,UR Std Dev,"));
  Serial.println(F("LR Average,LR Std Dev"));

#else
  // Set up to continuously report the scale output.
     
  /*
   * Load the calibrations into each Amplifier object.
   * For Y = MX + B, where X = weight and Y = Load Cell Value,
   *   set_scale() sets M,
   *   set_offset() sets B.
   */
  
  llHx711.set_scale(LL_SCALE);
  llHx711.set_offset(LL_OFFSET);
  
  lrHx711.set_scale(LR_SCALE);
  lrHx711.set_offset(LR_OFFSET);
  
  ulHx711.set_scale(UL_SCALE);
  ulHx711.set_offset(UL_OFFSET);
  
  urHx711.set_scale(UR_SCALE);
  urHx711.set_offset(UR_OFFSET);

#endif

}

void loop() {

#ifdef CALIBRATE_SCALE

  delay(2000);

  /*
   * Read and report the average and Standard Deviation for each load sensor.
   * For ease of pasting into the spreadsheet, print one row per set of measurements.
    */
    
  reportStatistics(&llHx711);
  Serial.print(F(","));
  reportStatistics(&ulHx711);
  Serial.print(F(","));
  reportStatistics(&urHx711);
  Serial.print(F(","));
  reportStatistics(&lrHx711);
  Serial.println();
  
#else

  Serial.println(F("No normal code ready yet");
  
#endif
}

#ifdef CALIBRATE_SCALE
/*
 * Reports calibration statistics for the given Load Cell Amplifier.
 * pHx = points to the corresponding Load Cell Amplifier controller.
 */
void reportStatistics(HX711 *pHx) {
  float average;        // simple mean of values[]
  float stddev;         // standard deviation from the mean.

  // Collect a set of readings.
  for (int i = 0; i < SAMPLES_PER_READING; ++i) {
    values[i] = pHx->read();
  }

  // Calculate the Average (Mean)
  average = 0.0f;
  for (int i = 0; i < SAMPLES_PER_READING; ++i) {
    average += values[i];
  }
  average /= (float) SAMPLES_PER_READING;

  /*
   * Calculate the standard deviation.
   */

  stddev = 0;
  for (int i = 0; i < SAMPLES_PER_READING; ++i) {
    stddev += (values[i] - average) * (values[i] - average);
  }
  stddev /= (float) SAMPLES_PER_READING;
  stddev = (float) sqrt(stddev);

  Serial.print(average, 1);
  Serial.print(F(","));
  Serial.print(stddev, 1);
}
#endif

