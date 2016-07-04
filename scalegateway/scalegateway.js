/*
 * scalegateway: a Raspberry Pi gateway that transfers
 * measurements from the Curie BLE Weight scale to the cloud.
 *
 * Status:
 * Not ready for use; development remains.
 * Currently: periodically sort of reads a set of weight measurements from the scale.
 *
 * NOTE: if the script connects to the scale, then exits without disconnecting from the scale,
 * the Arduino 101 BLE library won't turn advertising back on, and so is undiscoverable
 * until the scale is rebooted.
 * 
 * 
 * Copyright (c) 2016 Bradford Needham, North Plains, Oregon, USA
 * @bneedhamia, https://www.needhamia.com
 * Licensed under the GPL 2, a copy of which
 * should have been included with this software.
 */

var fs = require('fs');
var noble = require('noble');	// npm install noble  (see https://github.com/sandeepmistry/noble)
var log4js = require('log4js');	// np install log4js (see https://github.com/nomiddlename/log4js-node)

// UPLOAD_INTERVAL_MS = how often (milliseconds) to upload a set of data from the scale.
const UPLOAD_INTERVAL_MS = (40 * 1000);

// CONFIG_FILENAME = the local file containing our configuration. See startReadingAppConfig().
const CONFIG_FILENAME = 'properties.json';

/*
 * WEIGHT_SERVICE_UUID = standard BLE Service UUID for a weight scale service.
 * WEIGHT_MEASUREMENT_GATT_UUID = standard BLE Characteristic UUID for a weight measurement.
 */
const WEIGHT_SERVICE_UUID = '181d';
const WEIGHT_MEASUREMENT_GATT_UUID = '2a9d';

/*
 * USER_* - BLE "User" Ids for the scale's reported weights.
 * It reports multiple weights per measurement as the weights of 5 Users
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

const USER_TOTAL = 0;
const USER_UL = 1;
const USER_LL = 2;
const USER_UR = 3;
const USER_LR = 4;
const NUM_USERS = 5;
const USER_RESET = NUM_USERS;

var logger;		// file logger.
var properties;		// app configuration, read from CONFIG_FILENAME

/*
 * userWeights[] = indexed by USER_*, contains the weight (in kilograms)
 * of that user.  This is the data to upload to the data warehouse.
 *
 * Global because we need to read a set of USER_TOTAL..USER_LR
 * weight measurements before we have one consistent weight record to upload.
 */
var userWeights = [NUM_USERS];

/*
 * Reads our application's configuration from a local file.
 * Sets the variable "properties".
 * On error, exits.
 *
 * That file should be a JSON file with the following names:
 *   "bleLocalName" Required, String. Advertised LocalName of the BLE weight scale to read from.
 */
function startReadingAppConfig() {
  fs.readFile(CONFIG_FILENAME, 'utf8', function(err, data) {
    if (err) {
      logger.error('Failed to read config file, ' + CONFIG_FILENAME + ': ' + err);
      process.exit(1);
    }
  
    properties = JSON.parse(data);

    // Check that the necessary properties are there.

    if (!properties.bleLocalName || properties.bleLocalName.length == 0) {
      logger.error('Missing or blank bleLocalName in ' + CONFIG_FILENAME);
      process.exit();
    }
    logger.info(properties.bleLocalName);

    /*
     * Now that our configuration is all set up, start the periodic scale reading
     * and set up to do that periodically.
     */
    startScaleRead();
    setInterval(startScaleRead, UPLOAD_INTERVAL_MS);

    function startScaleRead() {
      logger.debug('Scanning started.');
      noble.startScanning();
    };
  });
};


function initialize() {
  var myModuleName;		// name of my module, to appear in the log

  // Set up logging to a file.
  myModuleName = __filename.substring(__filename.lastIndexOf('/') + 1);
  log4js.loadAppender('file');
  //log4js.addAppender(log4js.appenders.console());
  log4js.addAppender(log4js.appenders.file('logs/scalegateway.log'), myModuleName);

  logger = log4js.getLogger(myModuleName);
  logger.setLevel('DEBUG');		// level of output, in order: DEBUG, INFO, WARN, ERROR, FATAL


  startReadingAppConfig();
}


/*
 * This function is the beginning of the app flow.
 * Called when the BLE adapter is available or unavailable.
 */
noble.on('stateChange', function(state) {
  if (state === 'poweredOn') {
    initialize();	// set up our program
  } else {
    logger.error('BLE adapter turned off unexpectedly. Exiting.');
    noble.stopScanning();
    exit(1);
  }
});


/*
 * Called when a BLE device is discovered (from that device's advertising)
 */
noble.on('discover', function(peripheral) {
  var localName = peripheral.advertisement.localName;

  // A BLE device has been discovered.  If it's the one we're looking for, connect to it.
  if (properties.bleLocalName != localName) {
    logger.info('ignoring BLE device ' + localName + '. Continuing to scan');
    return; // skip this uninteresting device.
  }

  logger.info('Found device named ' + localName);
  noble.stopScanning();	// make sure we don't scan for more devices.

  /*
   * Connect to the device and find its services and characteristics.
   * NOTE: If our app exits without calling .disconnect(),
   * the Arduino 101 BLE library will be stuck in a non-advertising mode
   * and will need to be rebooted.
   */
  peripheral.connect(function(err) {
    if (err) {
      logger.info('connected error = ' + err);
      return;
    }
    logger.debug('Connected');

    // Search for the Service we want.
    var svcUuids = [];
    svcUuids[0] = WEIGHT_SERVICE_UUID
    peripheral.discoverServices(svcUuids, function(err, services){
      var service;  // our service of interest

      if (err) {
        logger.error('DiscoverServices failed: ' + err);
        peripheral.disconnect();
        exit(1);
      }
      if (services.length != 1) {
        logger.error('DiscoverServices returned unexpected ' + services.length + ' Services');
        peripheral.disconnect();
        exit(1);
      }

      service = services[0];

      // Search for the characteristic we want.
      var gattUuids = [];
      gattUuids[0] = WEIGHT_MEASUREMENT_GATT_UUID;
      service.discoverCharacteristics(gattUuids, function(err, gatts) {
        var gatt;  // our characteristic of interest
        var i;
  
        if (err) {
          logger.error('DiscoverCharacteristics failed: ' + err);
          peripheral.disconnect();
          exit(1);
        }
        if (gatts.length != 1) {
          logger.error('DiscoverCharacteristics returned unexpected ' + gatts.length + ' Characteristics');
          peripheral.disconnect();
          exit(1);
        }
  
        gatt = gatts[0];

        //TODO BUG: this .on() call add another listener every time the characteristic is discovered- oops.
        gatt.on('data', function(data, isNotify) {
          var userWeight;	// userId and weight, returned by parseBleWeight()

          userWeight = parseBleWeight(data);
          logger.info('Received user ' + userWeight.userId + ' weight(kg) ' + userWeight.weightKg);

          /*
           * Weights are reported in order: USER_TOTAL first, then the others.
           * We want a consistent set of weights,
           * starting with USER_TOTAL and ending with NUM_USERS - 1.
           *
           * BUG: Twice I saw the scale report 0, 1, 0, 1, 2, 3, 4.... I wonder whether the scale is resetting?
           */
          if (userWeight.userId >= NUM_USERS) {
            return;	// skip USER_RESET because it's a temporary state.
          }
          if (userWeight.userId != USER_TOTAL && !userWeights[USER_TOTAL]) {
            return;	// skip reports until the start of a set.
          }

          userWeights[userWeight.userId] = userWeight.weightKg;

          if (userWeight.userId == NUM_USERS - 1) {
            // We've read a set of weights. 

            // Close up all the BLE things.
            gatt.unsubscribe();
            peripheral.disconnect(function(err) {
              logger.debug('Disconnected. Err = ' + err);
              logger.debug("Here's where we'd upload userWeights[].");
            });
          }
        });

        // Now that our callbacks is set up, turn on notification of new values.
        for (i = 0; i < NUM_USERS; ++i) {
          userWeights[i] = null;
        }
        gatt.subscribe();	// triggers 'data' event on notification
      });
    });
  });

});

 
/*
 * Parse the standard BLE Weight Measurement characteristic.
 * param bleData = the raw bytes of the characteristic.
 * returns an object with fields 'userId' = the user, and 'weightKg' = reported weight in Kilograms.
 *
 * See the BLE spec or the scale's Arduino Sketch for the format of this data:
 * [0] = flags
 * [1] = Weight least-significant byte
 * [2] = Weight most-significant byte
 * [0] = User ID (see USER_* above)
 *
 * Flag values:
 * bit 0 = 0 means we're reporting in SI units (kg and meters)
 * bit 1 = 0 means there is no time stamp in our report
 * bit 2 = 0 means no User ID is in our report
 * bit 3 = 0 means no BMI and Height are in our report
 * bits 4..7 are reserved, and set to zero.
 */
function parseBleWeight(bleData) {
  var userWeight = new Object();	// value to return
  var wFlags;		// flags for the weight encoding
  var i;

  // For debugging, report the bytes of data
  for (i = 0; i < bleData.length; ++i) {
    logger.info(bleData[i]);
  }

  if (bleData.length != 4) {
    logger.error('Garbled BLE Weight measurement: data length = ' + bleData.length);
    return;
  }

  // Check that the flags match our expectations
  wFlags = bleData[0];
  if ((wFlags & 0x01)) {  // we assume SI units
    logger.error('Skipping unexpected Weight Flag: scale is reporting in Imperial units instead of SI units');
    return;
  }
  if ((wFlags & 0x02)) {  // we assume no timestamp
    logger.error('Skipping unexpected Weight Flag: scale includes a timestamp');
    return;
  }
  if ((wFlags & 0x04) == 0) {  // we assume a user id
    logger.error("Skipping unexpected Weight Flag: scale doesn't report user ID");
    //BUG: the scale says no user ID, but does include it.  return;
  }
  if ((wFlags & 0x08)) {  // we assume no BMI or Height
    logger.error('Skipping unexpected Weight Flag: scale includes BMI and Height');
    return;
  }

  // Assemble the weight, scaled by the standard BLE value.
  userWeight.weightKg = (bleData[2] << 8) + bleData[1];
  userWeight.weightKg = (userWeight.weightKg * 5.0) / 1000.0;

  userWeight.userId = bleData[3];

  return userWeight;
}
