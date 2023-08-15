
let transport,
  unistream, bistream,
  datagram;

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
  async acceptUnidirectionalStreams() {
    let reader = this.transport.incomingUnidirectionalStreams.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          addToEventLog('Done accepting unidirectional streams!');
          return;
        }
        let stream = value;
        addToEventLog('New incoming unidirectional stream');
        this.readFromIncomingStream(stream);
      }
    } catch (e) {
      addToEventLog('Error while accepting streams: ' + e, 'error');
    }
  }

  //TODO: create uni stream
  async readFromIncomingStream(stream) {
    let decoder = new TextDecoderStream('utf-8');
    let reader = stream.pipeThrough(decoder).getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          addToEventLog('Stream closed');
          return;
        }
        let data = value;
        addToEventLog('Received data on uni stream : ' + data);
      }
    } catch (e) {
      addToEventLog(
        'Error while reading from stream : ' + e, 'error');
      addToEventLog('    ' + e.message);
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
      addToEventLog(
        'Error while reading from stream : ' + e, 'error');
      addToEventLog('    ' + e.message);
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
async function connect() {
  const url = document.getElementById('url').value;
  try {
    transport = new Transport(url);
    addToEventLog('Initiating connection...');
  } catch (e) {
    addToEventLog('Failed to create connection object. ' + e, 'error');
    return;
  }

  transport.onclose = (error_code, reason) => {
    addToEventLog(`Connection closed , ${error_code} , ${reason}.`);
  }

  try {
    await transport.connect();
    addToEventLog('Connection ready.');
  } catch (e) {
    addToEventLog('Connection failed. ' + e, 'error');
    return;
  }

  transport.acceptUnidirectionalStreams();

  datagram = await transport.createDatagram();
  datagram.onmessage = (data) => {
    addToEventLog('Received data on datagram: ' + data);
  };
  datagram.init();
  //
  bistream = await transport.createBiStream();
  bistream.onmessage = (data) => {
    addToEventLog('Received data on bistream: ' + data);
  };
  bistream.init();
  //
  unistream = await transport.createUniStream();
  unistream.init();

  document.forms.sending.elements.send.disabled = false;
  document.getElementById('connect').disabled = true;
  document.getElementById('disconnect').disabled = false;
}

// Disconnect
async function disconnect() {
  await transport.disconnect();

  document.getElementById('connect').disabled = false;
  document.getElementById('disconnect').disabled = true;
}

// "Send data" button handler.
async function sendData() {
  let form = document.forms.sending.elements;
  let encoder = new TextEncoder('utf-8');
  let rawData = sending.data.value;
  let data = encoder.encode(rawData);

  try {
    switch (form.sendtype.value) {
      case 'datagram': {
        await datagram.write(data);
        addToEventLog('Sent datagram: ' + rawData);
        break;
      }
      case 'unidi': {
        await unistream.write(data);
        addToEventLog('Sent unidi: ' + rawData);
        break;
      }
      case 'bidi': {
        await bistream.write(data);
        addToEventLog(
          'Sent bidi: ' + rawData);
        break;
      }
    }
  } catch (e) {
    addToEventLog('Error while sending data: ' + e, 'error');
  }
}

function addToEventLog(text, severity = 'info') {
  let log = document.getElementById('event-log');
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