/*
 * scalegateway: a Raspberry Pi gateway that transfers
 * mesurements from the Curie BLE Weight scale to the cloud.
 *
 * Status:
 * Not ready for use; lots of development remains.
 * This currently contains too much code from noble's test.js
 * and will be rewritten.
 * Currently: sort of reads a single weight measurement from the scale.
 * 
 * 
 * Copyright (c) 2016 Bradford Needham, North Plains, Oregon, USA
 * @bneedhamia, https://www.needhamia.com
 * Licensed under the GPL 2, a copy of which
 * should have been included with this software.
 */

var noble = require('noble');  // npm install noble  (see https://github.com/sandeepmistry/noble)
var log4js = require('log4js'); // np install log4js (see https://github.com/nomiddlename/log4js-node)
var fs = require('fs');

// CONFIG_FILENAME = the local file containing our configuration. See startReadingAppConfig().
const CONFIG_FILENAME = 'properties.json';

// RUN_INTERVAL_MS = how often (milliseconds) to upload a set of data from the scale.
const RUN_INTERVAL_MS = (30 * 1000);

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
var properties;		// global configuration, read from CONFIG_FILENAME

var scanIntervalId = null;	// setInterval() return value. ID to clear to stop periodic scanning.

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
    scanIntervalId = setInterval(startScaleRead, RUN_INTERVAL_MS);

    function startScaleRead() {
      logger.debug('Scanning started.');
      noble.startScanning();
    };
  });
};


function initialize() {
  var myModuleName;		// name of my module, to appear in the log
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

noble.on('scanStart', function() {
  logger.info('on -> scanStart');
});

noble.on('scanStop', function() {
  logger.info('on -> scanStop');
});

noble.on('discover', function(peripheral) {
  logger.info('on -> discover');

  peripheral.on('servicesDiscover', function(services) {
    logger.info('on -> peripheral services discovered');

    // Find the weight service, if it's advertised.  If not, we're done.

    var serviceIndex = -1;
    for (serviceIndex = 0; serviceIndex < services.length; ++serviceIndex) {
      if (services[serviceIndex].uuid == '181d') {
        break;
      }
    }
    if (serviceIndex >= services.length) {
      logger.error('No ' + 'weight' + ' service found on device.');
      peripheral.disconnect();
      return;
    }

    services[serviceIndex].on('includedServicesDiscover', function(includedServiceUuids) {
      // Find the service's characteristics (gatts)
      this.discoverCharacteristics();
    });

    services[serviceIndex].on('characteristicsDiscover', function(characteristics) {
 
      /*
       * Parse the standard BLE Weight Measurement characteristic.
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
        var wFlags;		// flags for the weight encoding
        var userId;		// 'user' having this weight. See USER_* above
        var weightKg;		// the reported weight, in kilograms
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
        weightKg = (bleData[2] << 8) + bleData[1];
        weightKg = (weightKg * 5.0) / 1000.0;

        userId = bleData[3];

        logger.info('User ' + userId + ' weight: ' + weightKg + ' kg');
        
      }

      // Find the Weight Measurement Characteristic.
      var characteristicIndex = -1;
      for (characteristicIndex = 0; characteristicIndex < characteristics.length; ++characteristicIndex) {
        if (characteristics[characteristicIndex].uuid == '2a9d') {
          break;
        }
      }
      if (characteristicIndex >= characteristics.length) {
          logger.error('  No weight measurement characteristic found.');
          peripheral.disconnect();
          return;
      }

      characteristics[characteristicIndex].on('read', function(data, isNotification) {
        // we're here when the weight is read.
        parseBleWeight(data);

        characteristics[characteristicIndex].notify(false);
        peripheral.disconnect();
      });



      characteristics[characteristicIndex].on('notify', function(state) {
        characteristics[characteristicIndex].read();

      });


      // Now that our callbacks are set up, turn on notification of new values.
      characteristics[characteristicIndex].notify(true);
    });

    
    // Now that we've found the scale's Weight service, find the next level.
    services[serviceIndex].discoverIncludedServices();
  });

  // A BLE device has been discovered.  If it's the one we're looking for, connect to it.

  var localName = peripheral.advertisement.localName;

  if (properties.bleLocalName == localName) {
    logger.info('Found device named ' + localName);
    noble.stopScanning();	// make sure we don't scan for more devices.

    peripheral.connect(function(err) {
      logger.debug('connected to ' + peripheral);
      if (err) {
        logger.info('connected error = ' + err);
        return;
      }

      // We've successfully connected. Find what Services the device offers.
      peripheral.discoverServices();
    });

  } else {
    //logger.info('ignoring BLE device ' + localName + '. Continuing to scan');
  }
});

