/*
 * Dog Bed Weight Scale for Arduino/Genuino 101.
 * 
 * This Sketch periodically reports, through BLE, the weight on the bed
 * and the weight sensed by each of its four Load Sensors.
 * This data provides enough information for a cloud service to calculate
 * when the dog is in or out of the bed and where on the bed the dog
 * is lying (center of gravity), which may be used to infer restlessness.
 * 
 * 
 * Parts Required.  See BillOfMaterials.ods for the full list.
 * - 4 load sensors
 * - 1 proto board that converts the Load Sensors into Wheatstone Bridges
 *   by adding two resistors to each Load Sensor circuit.
 * - 4 Load Cell Amplifier boards (HX711), one per Load Sensor
 * - 1 Arduino 101 (for sending measurements via BLE)
 * 
 * BLE (Bluetooth Low Energy) interface:
 * - The scale appears as a standard BLE Weight Scale device.
 * - It reports that it supports multiple Users
 *   (that is, multiple people weighing themselves).
 * - It reports the weight of 5 "Users", in the following sequence:
 *   User 0 = total weight (kg) on the scale, including the plywood top.
 *   User 1 = weight (kg) measured by the Upper-Left Load Sensor.
 *   User 2 = weight (kg) on the Lower-Left Load Sensor.
 *   User 3 = weight (kg) on the Upper-Right Load Sensor.
 *   User 4 = weight (kg) on the Lower-Right Load Sensor.
 *   You may or may not see it report a User 5 weight on reset - that value
 *   is quickly replaced by one of the others.
 *   Because all these "User" weights share one BLE Characteristic,
 *   each User's weight is reported for a few seconds before it is overwritten
 *   by the next one.
 * 
 * To Use:
 * - Calibrate:
 *   - Run this Sketch with CALIBRATE_SCALE uncommented.
 *   - Let the scale warm up (1/2 hour or so).
 *   - Take everything off the scale, including the top plywood circle.
 *   - Ideally, leave the room for 10 minutes to gather data that isn't
 *     affected by the vibration of the floor.
 *   - Record the values for zero-load.  Those are the Offset values.
 *   - Measure the weight of the plywood top with a bathroom scale.
 *   - Place the Plywood top on the center of the scale.
 *   - wait some time (perhaps a day) to accomodate Load Sensor Creep.
 *   - As above, leave the room for 10 minutes.
 *   - Record the values for the weight of the plywood top / 4
 *   - Measure the weight of a known weight, such as an exercise weight.
 *   - Place the weight on the center of the scale.
 *   - wait some time (perhaps a day) to accomodate Load Sensor Creep.
 *   - Leave the room as above.
 *   - Record the values for the plywood top + the known weight / 4
 *   - Repeat this process for a set of various weights,
 *     Especially weights that are approximately the weight of your dog.
 *   - Using the known weights and corresponding values,
 *     estimate the Scale value for each load sensor.  See Calculations.ods
 *     
 * - Run:
 *   - Comment out CALIBRATE_SCALE.
 *   - Set *_OFFSET and *_SCALE to the values you calculated above.
 *   - Start the Sketch.
 *   - Read the reported weights, etc. using a BLE device.
 *   - Typically you'll want to use a BLE-to-WiFi gateway
 *     (such as a Raspberry Pi 3) to send the data to a cloud
 *     data warehouse such as http://data.sparkfun.com
 *     
 * For debugging the BLE communication, I like the Nordic BLE phone apps:
 * https://play.google.com/store/apps/details?id=no.nordicsemi.android.mcp
 * https://play.google.com/store/apps/details?id=no.nordicsemi.android.nrftoolbox
 *     
 * Copyright (c) 2016 Bradford Needham, North Plains, Oregon, USA
 * @bneedhamia, https://www.needhamia.com
 * Licensed under the GPL 2, a copy of which
 * should have been included with this software.
 */

#include "HX711.h"     // https://github.com/bogde/HX711 Load Cell Amp library
#include <CurieBLE.h>  // Arduino 101 BLE library.
// 80 column marker follows:
//345678901234567892123456789312345678941234567895123456789612345678971234567898

/*
 * USER_* - BLE "User" Ids for our reported weights.
 * We report multiple weights per measurement as the weights of 5 Users
 * 
 * USER_TOTAL = The User Id representing the total weight on the scale.
 * USER_UL = The User Id representing the weight on the Upper-left Load Sensor.
 * USER_LL = the same for the Lower-Left Load Sensor.
 * USER_UR = the same for the Upper-Right Load Sensor.
 * USER_LR = the same for the Lower-Right Load Sensor.
 * 
 * NUM_USERS = the number of different "Users" we report.
 * 
 * USER_RESET = the User Id indicating that the scale has been reset.
 *   Not considered one of the regularly-reported users.
 */

const uint8_t USER_TOTAL = 0;
const uint8_t USER_UL = 1;
const uint8_t USER_LL = 2;
const uint8_t USER_UR = 3;
const uint8_t USER_LR = 4;
const uint8_t NUM_USERS = 5;
const uint8_t USER_RESET = NUM_USERS;

/*
 * Advertised name of our BLE device (the scale).
 * You can change this to whatever you want,
 * as long as the gateway knows the name.
 */
const char *BLE_LOCAL_NAME = "K9 Kilos";

/*
 * CALIBRATE_SCALE = uncomment this line to report raw
 *  Load Cell Amplifier values for calculating calibration.
 * Comment out this line to run the normal scale software.
 */
#define CALIBRATE_SCALE 1

/*
 * Calibrated values of the linear equation for each set of
 *   Load Cell Amplifier + Load Sensor + Protoboard resistors.
 * You will need to recalibrate if you replace a Load Sensor,
 *   a Load Cell Amplifier board, or any Protoboard resistors.
 *   
 * UL_OFFSET = zero-load offset for the Upper Left Load Sensor,
 *   calculated from CALIBRATE_SCALE readings with nothing,
 *   not even the top plywood circle, on the scale.
 * UL_SCALE_KG = scale from Amplifier units to kg for that Load Sensor.
 *   That is, number of Amplifier reading units per Kilogram.
 *   Calculated from CALIBRATE_SCALE and a spreadsheet. See Calculations.ods
 * 
 * LL_* = Same for Lower Right Load Sensor.
 * UR_* = same for Upper Right
 * LR_* = same for Lower Right
 */

const long UL_OFFSET = 19907L;
const long LL_OFFSET = -22697L;
const long UR_OFFSET = -61289L;
const long LR_OFFSET = -90326L;

const float UL_SCALE_KG = 52814.608;
const float LL_SCALE_KG = 53901.565;
const float UR_SCALE_KG = 45114.260;
const float LR_SCALE_KG = 40808.347;

/*
 * Dimensions of the Load Sensor rectangle.
 * For calculating center of gravity.
 * Measured by hand from the assembled scale.
 * 
 * SCALE_MM_X = width (millimeters) between
 *   the Lower-Left and Lower-Right Load Sensor tops.
 * 
 * SCALE_MM_Y = height (millimeters) between
 *   the Lower-Left and Upper-Left Load Sensor tops.
 */
const float SCALE_MM_X = 708.0f; // (measured 706 and 710)
const float SCALE_MM_Y = 709.0f; // (measured 710 and 708)

/*
 * MS_PER_WEIGHT_READING = time (ms) for each reading the scale weight.
 *   That is, the time per record of data eventually uploaded to the cloud.
 *   NOTE: must be divisible by (NUM_USERS + 1); that is: 6.
 *   The shorter this time is, the more data will be uploaded.
 *   The longer this time is, the more likely we'll miss some movement.
 *   During BLE testing (with no uploading) you probably want to set this
 *   to a under 1 minute (for example, 18000L);
 *   When uploading data to a service, you probably want to set this
 *   to at least a minute (60000L).
 *   If you find your gateway is missing data, increase this number.
 * 
 * MS_PER_WEIGHT_REPORTED = time (ms) the BLE Weight value will remain unchanged  
 *   before it's replaced by a new BLE value.  Necessary because each
 *   weight reading from the scale produces 5 different weights (see USER_*),
 *   which share a single BLE Characteristic.
 *   NOTE: we add one reporting interval to the reading interval
 *   so that we don't miss reporting something because of minor delays.
 */
const unsigned long MS_PER_WEIGHT_READING = 18L * 1000L;
const unsigned long MS_PER_WEIGHT_REPORTED = MS_PER_WEIGHT_READING
  / (NUM_USERS + 1);

/*
 * SAMPLES_PER_WEIGHT = number of raw values to average
 *   per reading from a given Load Sensor.
 *   The higher this number, the less noise will appear in readings.
 *   The lower this number, the quicker the readings will occur,
 *   which will make the scale more accurate when the dog is moving.
 */
const int SAMPLES_PER_WEIGHT = 5;

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

#ifdef CALIBRATE_SCALE
/*
 * SAMPLES_PER_READING = number of samples per calibration reading.
 * values[] = individual readings to do statistics on.
 */
const int SAMPLES_PER_READING = 40;
float values[SAMPLES_PER_READING];
#endif

/*
 * ulHx711 = controller for the Upper Left HX711 Load Cell Amplifier.
 * llHx711 = Same for Lower Right Load Sensor.
 * urHx711 = same for Upper Right
 * lrHx711 = same for Lower Right
 */
HX711 ulHx711(PIN_HX711_UL_DOUT, PIN_HX711_UL_CLK);
HX711 llHx711(PIN_HX711_LL_DOUT, PIN_HX711_LL_CLK);
HX711 urHx711(PIN_HX711_UR_DOUT, PIN_HX711_UR_CLK);
HX711 lrHx711(PIN_HX711_LR_DOUT, PIN_HX711_LR_CLK);

/*
 * The BLE Objects we use to send data.
 * We send a Standard BLE "Weight Scale" Service,
 *   just like a BLE bathroom scale.
 * See https://developer.bluetooth.org/gatt/services/Pages/ServicesHome.aspx
 * for constants and encoding of BLE data for various purposes.
 * 
 * ble = root of our BLE Peripheral (Server; the Arduino)
 * bleWeightService = BLE service to transmit the total weight on the scale.
 * bleWeightFeature = the features supported by this weight device.
 *   The '4' = 4 bytes are required to store the (32-bit) value.
 * bleWeightMeasurement = the weight measurement itself.
 *   The '4' = 4 bytes are required to store the value:
 *   1 byte of flags, 2 bytes of weight, and 1 byte of User Id.
 */

BLEPeripheral ble;
BLEService bleWeightService("181D"); 
BLECharacteristic bleWeightFeature("2A9E", BLERead | BLENotify, 4);
BLECharacteristic bleWeightMeasurement("2A9D", BLERead | BLENotify, 4);

/*
 * *_kg = Weights (kg) read from each load sensor.
 * total_kg = total weight (kg) of everything currently on the scale,
 * including the top plywood circle.
 */
float ul_kg;
float ll_kg;
float ur_kg;
float lr_kg;

float total_kg;

/*
 * total_cog_mm_x/y = Center of gravity (millimeters) of
 * everything currently on the scale, including the top plywood circle,
 * dog bed, dog bed cover, and possibly the dog.
 */
float total_cog_mm_x;
float total_cog_mm_y;

/*
 * previousWeightTimeMs = Time (ms since reset) of the
 *   most recent weight reading.
 * Used to control how often we measure new Load Sensor values.
 * 
 * weightReportTimeMs = Time (ms since reset) of the
 *   most recent BLE report of weight.  Used because we report multiple
 *   "User" weights per weight reading.
 * weightReportUserId = BLE User Id of the most recent BLE report of weight.
 *   See USER_*.
 */
unsigned long previousWeightTimeMs;
unsigned long weightReportTimeMs;
uint8_t weightReportUserId;


void setup() {
  Serial.begin(9600);

#ifdef CALIBRATE_SCALE
  // On Arduino 101, wait for the PC to open the port.
  while (!Serial);
  
  Serial.print(F("Calibrating, "));
  Serial.print(SAMPLES_PER_READING);
  Serial.println(F(" Samples per row."));

  // This line is formatted so you can import into a spreadsheet
  Serial.print(F("LL Average,LL Std Dev,"));
  Serial.print(F("UL Average,UL Std Dev,"));
  Serial.print(F("UR Average,UR Std Dev,"));
  Serial.println(F("LR Average,LR Std Dev"));

#else
     
  /*
   * Load the calibrations into each Amplifier object.
   * For the linear equation Y = MX + B,
   *   where X = weight and Y = Load Cell Value,
   *   set_scale() sets M,
   *   set_offset() sets B.
   */

  ulHx711.set_scale(UL_SCALE_KG);
  ulHx711.set_offset(UL_OFFSET);

  llHx711.set_scale(LL_SCALE_KG);
  llHx711.set_offset(LL_OFFSET);

  urHx711.set_scale(UR_SCALE_KG);
  urHx711.set_offset(UR_OFFSET);

  lrHx711.set_scale(LR_SCALE_KG);
  lrHx711.set_offset(LR_OFFSET);

  /*
   * Set the previous weight reading and reporting time to 0
   *   sothat we will immediately read and start reporting the weight.
   * Set the UserId so that the next UserId reported will be User 0.
   *   See USER_*.
   */
  previousWeightTimeMs = 0L;
  weightReportTimeMs = 0L;
  weightReportUserId = NUM_USERS;

  // Setup BLE (Bluetooth Low Energy)
  ble.setLocalName(BLE_LOCAL_NAME);
  ble.setAdvertisedServiceUuid(bleWeightService.uuid());
  ble.addAttribute(bleWeightService);
  ble.addAttribute(bleWeightFeature);
  ble.addAttribute(bleWeightMeasurement);

  // Make an initial measurement so we have something to report.
  measure();
  
  /*
   * Initialize our BLE Characteristics from that measurement
   * so that they have a value when we begin.
   * Note: this USER_RESET value will be overwritten almost immediately.
   *   Consequently, the gateway may not see it before it changes.
   */
  setBleWeightFeature();
  setBleWeightMeasurement(USER_RESET, total_kg);

  // Start the BLE radio
  ble.begin();

#endif

}


void loop() {

#ifdef CALIBRATE_SCALE

  delay(2000);

  /*
   * Read and report the average and Standard Deviation for each load sensor.
   * Formatted to paste the output into a spreadsheet.
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
  
  if (now - previousWeightTimeMs > MS_PER_WEIGHT_READING) {
    previousWeightTimeMs = now;

    /*
     * Force the weight reporting to start over, with the first user,
     * and to do the first report after the first reporting interval.
     * This keeps the reporting and the measuring in sync.
     */
    weightReportUserId = NUM_USERS;
    weightReportTimeMs = now;

    // read the weight and make all the calculations.
    measure();

    Serial.print(total_kg, 2);
    Serial.print(F(","));
    Serial.print(total_cog_mm_x);
    Serial.print(F(","));
    Serial.print(total_cog_mm_y);
    Serial.println();
  }

  /*
   * Each weight reading produces NUM_USERS different reports.
   * If it's time to report a new weight, do it.
   */
  if (now - weightReportTimeMs > MS_PER_WEIGHT_REPORTED) {
    weightReportTimeMs = now;

    ++weightReportUserId;
    if (weightReportUserId >= NUM_USERS) {
      weightReportUserId = 0;
    }

    // report the appropriate weight, based on the User Id.
    if (weightReportUserId == USER_TOTAL) {
      setBleWeightMeasurement(USER_TOTAL, total_kg);
      
    } else if (weightReportUserId == USER_UL) {
      setBleWeightMeasurement(USER_UL, ul_kg);
      
    } else if (weightReportUserId == USER_LL) {
      setBleWeightMeasurement(USER_LL, ll_kg);
      
    } else if (weightReportUserId == USER_UR) {
      setBleWeightMeasurement(USER_UR, ur_kg);
      
    } else if (weightReportUserId == USER_LR) {
      setBleWeightMeasurement(USER_LR, lr_kg);
      
    } else {
      // we get here only if there's a programming error.
      setBleWeightMeasurement(0xFF, 300.0);
    }
  }
  
#endif
}


/*
 * Perform one set of measurements:
 * - total_kg (weight)
 * - total_cog_mm_* (center of gravity)
 */
void measure() {

  // Read the weight (kg) from each Load Sensor
  ul_kg = ulHx711.get_units(SAMPLES_PER_WEIGHT);
  ll_kg = llHx711.get_units(SAMPLES_PER_WEIGHT);
  ur_kg = urHx711.get_units(SAMPLES_PER_WEIGHT);
  lr_kg = lrHx711.get_units(SAMPLES_PER_WEIGHT);

  /* 
   * Calculate the weight of everything on the scale:
   * top plywood circle, bed, bed cover, and possibly the dog.
   */
  total_kg = ll_kg + lr_kg + ul_kg + ur_kg;

  /*
   * Calculate the center of gravity of everything on the scale.
   * For the formula derivation, see the blog at https://needhamia.com/?p=750
   */

  total_cog_mm_x = SCALE_MM_X * (ur_kg + lr_kg) / total_kg;
  total_cog_mm_y = SCALE_MM_Y * (ul_kg + ur_kg) / total_kg;
}


/*
 * Initializes our BLE Characteristic
 * that describes what features our Weight device provides.
 */
void setBleWeightFeature() {
  unsigned long val = 0;          // field value
  unsigned char bytes[4] = {0};   // field value, encoded for transmission.
  
  /*
   * Flags.
   * 
   * bit 0 = 0 means no Time stamp provided.
   * bit 1 = 1 means multiple scale users are supported.
   * bit 2 = 0 means no BMI supported.
   * bits 3..6 = 7 means 0.01 kg resolution (that says nothing about accuracy).
   * bits 7..9 = 0 means height resolution unspecified.
   * bits 10..31 are reserved and should be set to 0.
   */

  val |= 0x0 << 0;
  val |= 0x1 << 1;
  val |= 0x0 << 2;
  val |= 0x7 << 3;
  val |= 0x0 << 7;

  // BLE GATT multi-byte values are encoded Least-Significant Byte first.
  bytes[0] = (unsigned char) val;
  bytes[1] = (unsigned char) (val >> 8);
  bytes[2] = (unsigned char) (val >> 16);
  bytes[3] = (unsigned char) (val >> 24);

  bleWeightFeature.setValue(bytes, sizeof(bytes));
}


/*
 * Sets our BLE Characteristic
 * given a weight measurement (in kg) and
 * the "User" the weight corresponds to.  0xFF = unknown user.
 * 
 * See https://developer.bluetooth.org/gatt/characteristics/Pages/CharacteristicViewer.aspx?u=org.bluetooth.characteristic.weight_measurement.xml
 *  for details of the encoding of weight in BLE.
 */
void setBleWeightMeasurement(uint8_t userId, float weightKg) {
  unsigned char flags = 0;      // description of the weight
  uint16_t newVal = 0;          // field value: the weight in BLE format
  unsigned char bytes[4] = {0}; // data, encoded for transmission.
  
  /*
   * Set the flags:
   * bit 0 = 0 means we're reporting in SI units (kg and meters)
   * bit 1 = 0 means there is no time stamp in our report
   * bit 2 = 0 means no User ID is in our report
   * bit 3 = 0 means no BMI and Height are in our report
   * bits 4..7 are reserved, and set to zero.
   */

  flags |= 0x0 << 0;
  flags |= 0x0 << 1;
  flags |= 0x0 << 2;
  flags |= 0x0 << 3;

  // Convert the weight into BLE representation
  newVal = (uint16_t) ((weightKg * 1000.0 / 5.0) + 0.5);

  /*
   * Because we are a continuous, periodic measurement device,
   * we set the BLE value and notify any BLE Client every time
   * we make a measurement, even if the value hasn't changed.
   * 
   * If instead we were designed to keep a BLE Client informed
   * of the changing value, we'd set the value only if the value changes.
   */

  bytes[0] = flags;

  // BLE GATT multi-byte values are encoded Least-Significant Byte first.
  bytes[1] = (unsigned char) newVal;
  bytes[2] = (unsigned char) (newVal >> 8);

  bytes[3] = userId;

  bleWeightMeasurement.setValue(bytes, sizeof(bytes));
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
   * Calculate the standard deviation:
   * the average of the squares of the differences from the Mean.
   */

  stddev = 0;
  for (int i = 0; i < SAMPLES_PER_READING; ++i) {
    stddev += (values[i] - average) * (values[i] - average);
  }
  stddev /= (float) SAMPLES_PER_READING;
  stddev = (float) sqrt(stddev);

  // Output the results, in a form to import into a spreadsheet.
  Serial.print(average, 1);
  Serial.print(F(","));
  Serial.print(stddev, 1);
}
#endif

