import { expect } from 'chai';
import * as sqs from '../src/index';

// sqs.on('log', (level, message, object) => {
//   console.log(`Log event: ${level}, ${message}, ${object}`);
// });

const queueName = 'nielskrijger-sqs-tst';

/**
 * Sends a number of messages to the SQS queue.
 */
function sendMessages(n = 0) {
  const promises = [];
  for (let i = 0; i < n; i++) {
    promises.push(sqs.sendMessage(queueName, i));
  }
  return Promise.all(promises);
}

/**
 * Clears queue of all messages by keep polling until depleted
 */
function clearQueue(queueName) {
  return sqs.poll(queueName, () => Promise.resolve(), { stopWhenDepleted: true });
}

describe('SQS', () => {
  let receivedMessages = [];
  let handlerCalled = 0;
  let handler = (messages) => {
    handlerCalled = handlerCalled + 1;
    receivedMessages = receivedMessages.concat(messages);
    return Promise.resolve();
  };

  beforeEach(() => {
    receivedMessages = [];
    handlerCalled = 0;
    sqs.init({
      region: process.env.AWS_DEFAULT_REGION,
    });
    return sqs.createQueue(queueName).then(() => {
      return clearQueue(queueName);
    });
  });

  describe('getUrl(...)', () => {
    it('should throw error when not initialized', () => {
      sqs.reset();
      expect(sqs.getUrl).to.throw(/init/);
    });
  });

  describe('poll(...)', () => {
    it('should consume messages one by one when maxMessages is 1', () => {
      return sendMessages(10)
        .then(() => {
          return sqs.poll(queueName, handler, { maxMessages: 1, stopWhenDepleted: true });
        }).then(() => {
          expect(receivedMessages.length).to.equal(10);
          expect(handlerCalled).to.equal(10);
        });
    });

    it('should consume multiple messages when maxMessages is 10', () => {
      return sendMessages(25)
        .then(() => {
          return sqs.poll(queueName, handler, { maxMessages: 10, stopWhenDepleted: true });
        }).then(() => {
          expect(receivedMessages.length).to.equal(25);

          // There is no guarantee how many messages are fetch every time
          // but we can be pretty sure it won't be 1 message at a time.
          expect(handlerCalled).to.be.within(3, 24);
        });
    });
  });
});
