export class MovingAverage {

    constructor(max_length=50) {
        this.data = [];
        this.max_length = max_length; 
    }
    average() {
        return this.data.reduce((a,b) => (a+b), 0) / this.data.length;
    }
    clear() {
        this.data = [];
    }
    getLastValue() {
        return this.data[this.data.length-1];
    }
    getValues() {
        return this.data;
    }
    update(new_value) {
        if (this.data.length == this.max_length) {
        this.data.shift(); // Removes first value in array
        }
        this.data.push(new_value); // Adds new value to the end of array
    }
}

export function average(data) {
    // Average of all values in the data array
    return data.reduce((a,b) => (a+b)) / data.length;
}

export function distanceXY(a, b) {
    // Computes the distance in the X-Y plane of points a and b
    // a, b: Either Vector2 or Vector3
    return Math.sqrt(Math.pow((a.x-b.x), 2) + Math.pow((a.y-b.y), 2));
}

export function distanceXYZ(a, b) {
    // Computes the distance in the X-Y plane of points a and b
    // a, b: Vector3
    return a.distanceTo(b);
}

export class LogMeasurements {

    constructor(socket, numberOfFrames=50, filename=null) {
        this.socket = socket;
        this.numFrames = numberOfFrames;
        this.filename = filename;
        this.isLogging = false;
    }
    initialise() {
        console.log('Logging started')
        this.isLogging = true;
        this.currentFrame = 0;
        this.socket.emit('log_initialise');
    }
    appendData(data_array) {
        if (this.isLogging && this.currentFrame < this.numFrames) {
            for (let i=0; i<data_array.length; i++) {
                let data = data_array[i];
                this.socket.emit('log_appendData', data);
            }
            this.currentFrame += 1;
        } else if (this.isLogging && this.currentFrame == this.numFrames) {
            this.stopAndSave();
        }
    }
    stopAndSave() {
        console.log('Logging stopped')
        this.isLogging = false;
        this.socket.emit('log_stopAndSave', this.filename);
    }
}