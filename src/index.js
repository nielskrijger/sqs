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
        eventEmitter.emit('log', 'debug', `Received ${messages.length} messages from queue '${queueName}'`);
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
 * Processes a message in the recursive consume process.
 *
 * Errors thrown by the handler function should not interrupt the polling
 * process, instead simply log an error.
 */
function processMessage(queueName, handler, message) {
  return handler(message).then((result) => {
    return deleteMessage(queueName, message.ReceiptHandle)
      .then(() => result);
  }).catch((error) => {
    eventEmitter.emit('log', 'error', error, message);
  });
}

/**
 * Recursive function that keeps polling for SQS messages and executes
 * a specified function for each SQS message received.
 *
 * The `handler` function must return a promise. After the promise is resolved
 * it automatically deletes the message from the SQS queue. If the promise
 * returns `false` polling stops after deleting the message.
 *
 * When the message could not be processed succesfully it will be retried or
 * moved to a dead-letter queue depending on your SQS settings. Any error
 * thrown will not stop polling; to stop the polling process `handler`
 * must return `false`.
 */
export function poll(queueName, handler, options = {}) {
  return receiveMessages(queueName).then((messages) => {
    eventEmitter.emit('log', 'debug', `Received ${messages.length} messages on SQS queue '${queueName}'`);

    // TODO receive multiple messages at once and process them in sequence or parallel
    if (messages.length > 0) { // There can be only one message at most
      return processMessage(queueName, handler, messages[0]).then((result) => {
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
