# CurieBLEWeightMonitor
Arduino/Genuino 101 (Curie) Sketch to continuously report my dog's weight using load sensors and Bluetooth Low Energy (BLE).
The scale sends the total weight on the scale (plywood top, bed, bed cover, and possibly the dog), as well as the
weight measured by each of the 4 Load Sensors at the corners of the scale.
This data should be sufficient to estimate whether the dog is in or out of the bed, how much the dog weighs,
whether the dog is restless or still, and where on the bed the dog is laying (center of gravity).

See the project blog, beginning at https://needhamia.com/?p=661 for all the details.
## Data Details
The Sketch periodically reports the total weight and weight at each Load Sensor in Kilograms and as Standard BLE Weight Characteristics.
The total weight and 4 Load Sensor weights are reported as the weights of 5 different BLE Users.  See the Sketch code/comments
for details of the timing of the sending of the weights.
## Files
- ProjectDiary.odt = day-to-day diary of the progress of the project. Useful to see how the project unfolded over time.
- CurieBLEWeightMonitor.ino = Arduino 101 Sketch to run on the scale.
- scalegateway = node.js code to upload data from the scale to the cloud via a Raspberry Pi or such.
- WeightScale.fzz = rudimentary Fritzing circuit diagram.
- BillOfMaterials.ods = parts list, with suppliers and prices.
- MechanicalNotes.odp = diagrams of any complicated physical parts.
- ProjectMath.odp = mathematical background to the formulas in the code. Also provides insight into the Load Sensor circuitry.
- Calculations.ods = Spreadsheet of testing and design measurements.
- loadsensorholder.FCStd = FreeCAD file for 3D printing hold-downs for the Load Sensors.
- loadsensorholder.stl = the corresponding STL file, which you can print from a variety of 3D printers.
- centeringguide.FCStd, .stl = FreeCAD and STL files for the nail Centering Guide used to align the top and bottom plywood pieces.
