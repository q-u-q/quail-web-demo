
class Transport {
    constructor(url) {
        this.url = url;
        this.transport = null;
        this.datagram = null;

        this.streams = new Map();
        this.streamId = 0;

        this.onclose = (error_code, reason) => { };
    }

    async connect() {
        //TODO: differentiate errors
        this.transport = new WebTransport(this.url);

        await this.transport.ready;

        this.transport.closed
            .then(({ closeCode, reason }) => {
                this.onclose(closeCode, reason);
            })
            .catch((error) => {
                this.onclose(-1, error.message);
            });
    }

    async createDatagram() {
        this.datagram = new Datagram(this.transport.datagrams);
        return this.datagram;
    }

    async disconnect() {
        if (this.datagram !== null) {
            this.datagram.close();
            this.datagram = null;
        }

        for (const [i, stream] of this.streams) {
            await stream.close();
        }

        await this.transport.close();
    }

    async createBiStream() {
        const raw_stream = await this.transport.createBidirectionalStream();
        const stream = new BiStream(raw_stream);
        this.streams.set(this.streamId++, stream);
        return stream;
    }

    async createUniStream() {
        const raw_stream = await this.transport.createUnidirectionalStream();
        const stream = new UniStream(raw_stream);
        this.streams.set(this.streamId++, stream);
        return stream;
    }

    //TODO: create uni stream
    async acceptUnidirectionalStreams(name) {
        let reader = this.transport.incomingUnidirectionalStreams.getReader();
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) {
                    addToEventLog(name, 'Done accepting unidirectional streams!');
                    return;
                }
                let stream = value;
                addToEventLog(name, 'New incoming unidirectional stream');
                this.readFromIncomingStream(name, stream);
            }
        } catch (e) {
            addToEventLog(name, 'Error while accepting streams: ' + e, 'error');
        }
    }

    //TODO: create uni stream
    async readFromIncomingStream(name, stream) {
        let decoder = new TextDecoderStream('utf-8');
        let reader = stream.pipeThrough(decoder).getReader();
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) {
                    addToEventLog(name, 'Stream closed');
                    return;
                }
                let data = value;
                addToEventLog(name, 'Received data on uni stream : ' + data);
            }
        } catch (e) {
            addToEventLog(name,
                'Error while reading from stream : ' + e, 'error');
            addToEventLog(name, '    ' + e.message);
        }
    }

}

class Writable {
    constructor() {
        this.writer = null;
    }

    async initWriter(writable) {
        this.writer = writable.getWriter();
    }

    async write(data) {
        await this.writer.write(data);
    }

    //TODO: add close
    async close() {
        await this.writer.close();
    }

}

class WritableReadable extends Writable {
    constructor() {
        super();
        this.reader = null;
        this.onmessage = (data) => { }
        this.onerror = (error) => { };
    }

    async initReader(readable) {
        let decoder = new TextDecoderStream('utf-8');
        this.reader = readable.pipeThrough(decoder).getReader();

        try {
            while (true) {
                const { value, done } = await this.reader.read();
                if (done) {
                    // stop reading
                    return;
                }
                this.onmessage(value)
            }
        } catch (e) {
            this.onerror(e);
        }
    }

    async close() {
        await super.close();
        await this.reader.cancel();
    }

}

class UniStream extends Writable {
    constructor(stream) {
        super();
        this.stream = { writable: stream };
    }

    async init() {
        this.initWriter(this.stream.writable);
    }
}

class BiStream extends WritableReadable {
    constructor(stream) {
        super();
        this.stream = stream;
    }

    async init() {
        this.initReader(this.stream.readable);
        this.initWriter(this.stream.writable);
    }
}

class Datagram extends WritableReadable {
    constructor(datagram) {
        super();
        this.datagram = datagram;
    }

    async init() {
        this.initReader(this.datagram.readable);
        this.initWriter(this.datagram.writable);
    }
}