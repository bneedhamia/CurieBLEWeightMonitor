# CurieBLEWeightMonitor
Arduino 101 (Curie) Sketch to continuously report my dog's weight using load sensors and Bluetooth Low Energy (BLE).
The scale sends the total weight on the scale (plywood top, bed, bed cover, and possibly the dog), as well as the
weight measured by each of the 4 Load Sensors. The individual Load Sensor values enable calculation of the center of
gravity (where the dog is on the bed).
## Current Status
The version 2 circuit is running. I'm calibrating the fully-assembled scale.
The Arduino 101 Sketch periodically sends the total weight (kg) and weight (kg) per Load Sensor.
 See ProjectDiary.odt for the progress on the project.
## Files
- ProjectDiary.odt = day-to-day diary of the progress of the project. Useful to see how the project unfolded over time.
- WeightScale.fzz = Fritzing circuit
- BillOfMaterials.ods = parts list, with suppliers and prices.
- MechanicalNotes.odp = diagrams of any complicated physical parts. (needs to be updated for the Version 2 scale design)
- ProjectMath.odp = mathematical background to the formulas in the code.
- Calculations.ods = Spreadsheet of testing and design measurements.
- loadsensorholder.FCStd = FreeCAD file for 3D printing hold-downs for the Load Sensors.
- loadsensorholder.stl = the corresponding STL file, which you can print from a variety of 3D printers.
- centeringguide.FCStd, .stl = FreeCAD and STL files for the nail centering guide to align the top and bottom plywood pieces.
