
let transports = new Map(),
  unistreams = new Map(), 
  bistreams = new Map(),
  datagrams = new Map();


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