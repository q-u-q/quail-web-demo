
let transports = new Map(),
  unistreams = new Map(), 
  bistreams = new Map(),
  datagrams = new Map();

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

// "Connect" button handler.
async function connect(name) {
  console.log('connect',name);
  const url = document.getElementById(`${name}-url`).value;

  let transport;

  try {
    transport = new Transport(url);
    transports.set(name,transport);

    addToEventLog(name, 'Initiating connection...');
  } catch (e) {
    addToEventLog(name, 'Failed to create connection object. ' + e, 'error');
    return;
  }

  transport.onclose = (error_code, reason) => {
    addToEventLog(name, `Connection closed , ${error_code} , ${reason}.`);
  }

  try {
    await transport.connect();
    addToEventLog(name, 'Connection ready.');
  } catch (e) {
    addToEventLog(name, 'Connection failed. ' + e, 'error');
    return;
  }

  transport.acceptUnidirectionalStreams(name);

  let datagram = await transport.createDatagram();
  datagrams.set(name, datagram);
  
  datagram.onmessage = (data) => {
    addToEventLog(name, 'Received data on datagram: ' + data);
  };
  datagram.onerror = (e) => {
    addToEventLog(name, 
      'Error while reading from stream : ' + e, 'error');
    addToEventLog(name, '    ' + e.message);
  }
  datagram.init();
  //
  let bistream = await transport.createBiStream();
  bistreams.set(name, bistream);

  bistream.onmessage = (data) => {
    addToEventLog(name, 'Received data on bistream: ' + data);
  };
  datagram.onerror = (e) => {
    addToEventLog(name,
      'Error while reading from stream : ' + e, 'error');
    addToEventLog(name, '    ' + e.message);
  };
  
  bistream.init();
  //
  let unistream = await transport.createUniStream();
  unistreams.set(name,unistream);

  unistream.init();

  document.getElementById(`${name}-send`).disabled = false;
  document.getElementById(`${name}-connect`).disabled = true;
  document.getElementById(`${name}-disconnect`).disabled = false;
}

// Disconnect
async function disconnect(name) {
  console.log('disconnect',name);

  let transport = transports.get(name);

  await transport.disconnect();

  document.getElementById(`${name}-connect`).disabled = false;
  document.getElementById(`${name}-disconnect`).disabled = true;
}

// "Send data" button handler.
async function sendData(name) {
  console.log('sendData',name);

  let form = document.forms[`${name}-sending`].elements;
  let encoder = new TextEncoder('utf-8');
  let rawData = form.data.value;
  let data = encoder.encode(rawData);

  try {
    switch (form.sendtype.value) {
      case 'datagram': {
        const datagram = datagrams.get(name);
        await datagram.write(data);
        addToEventLog(name, 'Sent datagram: ' + rawData);
        break;
      }
      case 'unidi': {
        const unistream = unistreams.get(name);
        await unistream.write(data);
        addToEventLog(name, 'Sent unidi: ' + rawData);
        break;
      }
      case 'bidi': {
        const bistream = bistreams.get(name);
        await bistream.write(data);
        addToEventLog(name, 
          'Sent bidi: ' + rawData);
        break;
      }
    }
  } catch (e) {
    addToEventLog(name, 'Error while sending data: ' + e, 'error');
  }
}

function addToEventLog(name, text, severity = 'info') {
  let log = document.getElementById(`${name}-event-log`);
  let mostRecentEntry = log.lastElementChild;
  let entry = document.createElement('li');
  entry.innerText = text;
  entry.className = 'log-' + severity;
  log.appendChild(entry);

  // If the most recent entry in the log was visible, scroll the log to the
  // newly added element.
  if (mostRecentEntry != null &&
    mostRecentEntry.getBoundingClientRect().top <
    log.getBoundingClientRect().bottom) {
    entry.scrollIntoView();
  }
}