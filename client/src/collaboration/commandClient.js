function id(prefix) { return `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`; }
export function sendCommand(socket, type, payload) {
  const command = { requestId: id('req'), eventId: id('evt'), type, ...(payload === undefined ? {} : { payload }) };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off('command-ack', received); reject(new Error('Command timed out')); }, 10000);
    function received(ack) { if (ack.requestId !== command.requestId) return; clearTimeout(timer); socket.off('command-ack', received); ack.status === 'committed' ? resolve(ack) : reject(Object.assign(new Error(ack.message), { code: ack.code })); }
    socket.on('command-ack', received); socket.emit('command', command);
  });
}
