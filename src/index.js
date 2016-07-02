import AWS from 'aws-sdk';
import EventEmitter from 'events';
import bluebird from 'bluebird';

let sqs = null;
const eventEmitter = new EventEmitter();
const queueUrls = []; // Caches queue urls

/**
 * Configures SQS setup.
 *
 * `init` should be called at most once.
 */
export function init(options) {
  sqs = new AWS.SQS(options);
  bluebird.promisifyAll(sqs);
}

/**
 * Resets client connection.
 *
 * This function is primarily here for testing purposes.
 */
export function reset() {
  sqs = null;
}

/**
 * Adds event listener to the end of the listeners array for the event named
 * `eventName`.
 *
 * Returns a reference to the EventEmitter so calls can be chained.
 */
export function on(eventName, listener) {
  eventEmitter.on(eventName, listener);
  return eventEmitter;
}

/**
 * Returns the queue url of specified `queueName`. Returns `null` when not found.
 *
 * Caches the results and returns the same result every time thereafter.
 */
export function getUrl(queueName) {
  if (!sqs) throw new Error('Must call init(...) first');
  if (!queueName) {
    return null;
  } else if (!queueUrls[queueName]) {
    const params = {
      QueueName: queueName,
    };
    return sqs.getQueueUrlAsync(params)
      .then((data) => {
        queueUrls[queueName] = data.QueueUrl;
        return queueUrls[queueName];
      }).catch((error) => {
        eventEmitter.emit('log', 'debug', `Queue '${queueName}' could not be found`, { error: error.message });
        return Promise.resolve(null);
      });
  }
  return Promise.resolve(queueUrls[queueName]);
}

/**
 * Returns specified queue ARN or `null` when queue does not exist.
 */
export function getArn(queueName) {
  return getUrl(queueName).then((queueUrl) => {
    if (queueUrl) {
      const params = {
        QueueUrl: queueUrl,
        AttributeNames: ['QueueArn'],
      };
      return sqs.getQueueAttributesAsync(params)
        .then(response => response.Attributes.QueueArn);
    }
    return null;
  });
}

/**
 * Creates an SQS queue with specified name if it does not already exist.
 *
 * Returns a promise with the AWS response.
 */
export function createQueue(queueName, attributes = {}) {
  eventEmitter.emit('log', 'info', `Creating SQS queue '${queueName}'`);

  // Check if queue already exists; when it already exists you cannot run
  // `sqs.createQueue` because it throws errors if you try to change any
  // existing queue attributes. In other words; never try to re-create an
  // existing queue.
  return getUrl(queueName).then((queueUrl) => {
    // Do not try to re-create the queue
    if (queueUrl) {
      eventEmitter.emit('log', 'info', `SQS queue '${queueName}' already exists`);
      return queueUrl;
    }

    // Create queue
    const params = {
      QueueName: queueName,
      Attributes: attributes,
    };
    return sqs.createQueueAsync(params).then((result) => {
      eventEmitter.emit('log', 'info', `Created SQS queue '${queueName}'`);
      return result;
    });
  });
}

/**
 * Sends a message to specified `queueName`. The `messageBody` is parsed to JSON.
 */
export function sendMessage(queueName, messageBody) {
  return getUrl(queueName).then((queueUrl) => {
    eventEmitter.emit('log', 'debug', `Sending message to queue '${queueName}'`, messageBody);
    const params = {
      MessageBody: JSON.stringify(messageBody),
      QueueUrl: queueUrl,
    };
    return sqs.sendMessageAsync(params);
  });
}

/**
 * Polls the SQS queue with `queueName` for new messages.
 */
export function receiveMessages(queueName, options = {}) {
  return getUrl(queueName).then((queueUrl) => {
    if (queueUrl == null) throw new Error(`Unable to find SQS queue '${queueName}'`);

    const params = {
      QueueUrl: queueUrl,
      MaxNumberOfMessages: (options.maxMessages) ? options.maxMessages : 1,
      WaitTimeSeconds: (options.waitTimeSeconds) ? options.waitTimeSeconds : 1,
    };
    return sqs.receiveMessageAsync(params)
      .then(({ Messages: messages }) => {
        if (!messages) return [];

        // Parse JSON message bodies
        eventEmitter.emit('log', 'debug', `Received ${messages.length} message(s) from queue '${queueName}'`);
        const deserialized = [];
        messages.forEach((message) => {
          try {
            deserialized.push({
              ReceiptHandle: message.ReceiptHandle,
              Body: JSON.parse(message.Body),
            });
          } catch (error) {
            eventEmitter.emit('log', 'error', 'Not a valid JSON SQS message, ignore it', {
              error,
              messageId: message.MessageId,
              message: message.Body,
            });
          }
        });
        return deserialized;
      });
  });
}

/**
 * Deletes a received message by it's receiptHandle.
 *
 * Throws error if queue could not be found.
 */
export function deleteMessage(queueName, receiptHandle) {
  return getUrl(queueName).then((queueUrl) => {
    if (queueUrl == null) throw new Error(`Unable to find SQS queue '${queueName}'`);

    const params = {
      QueueUrl: queueUrl,
      ReceiptHandle: receiptHandle,
    };
    return sqs.deleteMessageAsync(params);
  });
}

/**
 * Processes a batch of messages in the recursive consume process.
 *
 * Errors thrown by the handler function should not interrupt the polling
 * process, instead simply log an error.
 */
function processMessages(queueName, handler, messages) {
  return handler(messages).then(result => {
    const promises = [];
    messages.forEach(message => promises.push(deleteMessage(queueName, message.ReceiptHandle)));
    return Promise.all(messages).then(() => result);
  }).catch(error => {
    eventEmitter.emit('log', 'error', error);
  });
}

/**
 * Recursive function that keeps polling for SQS messages and executes
 * a specified function for all SQS message received.
 */
export function poll(queueName, handler, options = {}) {
  return receiveMessages(queueName, options).then((messages) => {
    eventEmitter.emit('log', 'debug', `Received ${messages.length} message(s) on SQS queue '${queueName}'`);
    if (messages.length > 0) {
      return processMessages(queueName, handler, messages).then((result) => {
        if (result === false) {
          eventEmitter.emit('log', 'debug', `Stopped polling SQS queue '${queueName}'`);
          return null;
        }
        return poll(queueName, handler, options);
      });
    } else if (messages.length === 0 && options.stopWhenDepleted === true) {
      // Stop polling when no more messages were received
      return null;
    }
    return poll(queueName, handler, options);
  });
}
