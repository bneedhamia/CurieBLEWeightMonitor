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
//#define CALIBRATE_SCALE 1

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
 * MS_PER_WEIGHT_SAMPLE = time (ms) between reported samples of weight.
 * The shorter this time is, the more data will be uploaded.
 * The longer this time is, the more likely we'll miss some movement.
 */
const unsigned long MS_PER_WEIGHT_SAMPLE = 3000L;
const int SAMPLES_PER_WEIGHT = 5;  // number of samples per weight reading.

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

const long UR_OFFSET = -61385L;
const float UR_SCALE = 68956.376;
 
const long LR_OFFSET = -89839L;
const float LR_SCALE = 29606.447;

const long UL_OFFSET = 13982L;
const float UL_SCALE = 33977.364;

const long LL_OFFSET = -17827L;
const float LL_SCALE = 64018.729;

/*
 * Dimensions of the Load Sensor rectangle.
 * For calculating center of gravity.
 * Measured by hand from the assembled scale.
 * 
 * SCALE_MM_X = width (millimeters) between Lower-Left
 * and Lower-Right Load Sensor buttons (the place where the load sits).
 * 
 * SCALE_MM_Y = height (millimeters) between Lower-Left
 * and Upper-Left Load Sensor buttons.
 */
const float SCALE_MM_X = 708.0f; // (706 and 710)
const float SCALE_MM_Y = 709.0f; // (710 and 708)

// *Hx711 = controller for each HX711 Load Cell Amplifier
HX711 llHx711(PIN_HX711_LL_DOUT, PIN_HX711_LL_CLK);
HX711 lrHx711(PIN_HX711_LR_DOUT, PIN_HX711_LR_CLK);
HX711 ulHx711(PIN_HX711_UL_DOUT, PIN_HX711_UL_CLK);
HX711 urHx711(PIN_HX711_UR_DOUT, PIN_HX711_UR_CLK);

/*
 * *_kg = Weights (kg) read from each load sensor.
 * total_kg = total weight (kg) of everything currently on the scale,
 * including the top plywood circle.
 */
float ll_kg = 0.0;
float lr_kg = 0.0;
float ul_kg = 0.0;
float ur_kg = 0.0;

float total_kg = 0.0;

/*
 * total_cog_mm_x/y = Center of gravity (millimeters) of
 * everything currently on the scale,
 * including the top plywood circle.
 */
float total_cog_mm_x = 0.0;
float total_cog_mm_y = 0.0;

/*
 * previous_weight_time_ms = Time (ms since reset) of the previous weight reading.
 */
unsigned long previous_weight_time_ms = 0L;


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
  Serial.println(F("Scale running. Output in kg, mm x, mm y"));
     
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

  previous_weight_time_ms = 0L;

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

  unsigned long now = millis();

  // If it's time to process a sample, do it.
  
  if (now - previous_weight_time_ms > MS_PER_WEIGHT_SAMPLE) {
    previous_weight_time_ms = now;
    
    readkg();  // load *_kg with the weight from the Load Cell Amplifiers
    calculate_total_center_of_gravity();

    Serial.print(total_kg, 2);
    Serial.print(F(","));
    Serial.print(total_cog_mm_x);
    Serial.print(F(","));
    Serial.print(total_cog_mm_y);
    Serial.println();
  }
  
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

/*
 * Reads the weight(kg) from each Load Cell Amplifier
 * and copies the result into ll_kg, lr_kg, ur_kg, and lr_kg.
 * 
 * Calculates the weight of everything on the scale:
 * plywood top circle, bed, bed cover, and possibly the dog.
 */
void readkg() {
  ll_kg = llHx711.get_units(SAMPLES_PER_WEIGHT);
  lr_kg = lrHx711.get_units(SAMPLES_PER_WEIGHT);
  ul_kg = ulHx711.get_units(SAMPLES_PER_WEIGHT);
  ur_kg = urHx711.get_units(SAMPLES_PER_WEIGHT);

  total_kg = ll_kg + lr_kg + ul_kg + ur_kg;
}

/*
 * Calculates the center of gravity of everything on the scale:
 * plywood top circle, bed, bed cover, and possibly the dog.
 */
void calculate_total_center_of_gravity() {
  // For the formula derivation, see the blog at https://needhamia.com/?p=750

  total_cog_mm_x = SCALE_MM_X * (ur_kg + lr_kg) / total_kg;
  total_cog_mm_y = SCALE_MM_Y * (ul_kg + ur_kg) / total_kg;
}

