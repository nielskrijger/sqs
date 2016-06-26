# SQS

A wrapper for [nodejs-cassandra](https://github.com/datastax/nodejs-driver) library, providing promises and a set of convenience methods.

**NOTE**: this library is not very customizable nor will it be, its intent is to serve as a standard for my personal projects. There are only few tests because its use is extensively tested in component tests.

## init(options)

Run `init(options)` before executing any statements.

```js
cassandra.connect({
  region: 'eu-west-1',
});
```

Other connection options can be found in the  [AWS SDK](http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/SQS.html).

## getUrl(queueName)

Retrieves the queue url of specified `queueName`. Returns `null` when not found.

Caches the results and returns the same result every time thereafter.

```js
return sqs.getUrl('my-queue').then((queueUrl) => {
  console.log(queueUrl); // https://sqs.eu-west-1.amazonaws.com/1234567890/my-queue
}
```

## getArn(queueName)

Returns specified queue ARN or `null` when queue does not exist.

```js
return sqs.getArn('my-queue').then((queueArn) => {
  console.log(queueArn); // arn:aws:sqs:eu-west-1:1234567890:my-queue
}
```

## createQueue(queueName, attributes = {})

Creates an SQS queue with specified name if it does not already exist.

Returns a promise with the AWS response.

Additional queue attributes can be found in [AWS SDK docs](http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/SQS.html)

```js
const attributes = {
  ReceiveMessageWaitTimeSeconds: '20',
};
return sqs.createQueue('my-queue', attributes)
```

## sendMessage(queueName, messageBody)

Sends a message to specified `queueName`. The `messageBody` must be an object and is stringified.

Returns a promise with the AWS response.

```js
const message = {
  action: 'deleteUser',
  user_id: 'a582d99',
};
return sqs.sendMessage('my-queue', message);
```

## receiveMessages(queueName, options = {})

Retrieves messages from the SQS queue `queueName`.

Returns an array with all messages received or an empty array when none were available. Messages that do not contain a valid JSON message body are silently ignored; that is they will not be returned and will re-appear in the SQS queue after visibility timeout has been reached.

Throws an error if queue could not be found.

```js
return sqs.receiveMessages('my-queue').then((messages) => {
  console.log('messages');
}
```

Option          | Default | Description
----------------|---------|-----------------------------
maxMessages     |       1 | Maximum number of messages to retrieve. Between 1-10.
waitTimeSeconds |       0 | The time for which a ReceiveMessage call will wait for a message to arrive. An integer from 0 to 20 (seconds). When 0 polling switches to short polling which returns immediately.

## deleteMessage(queueName, receiptHandle)

Deletes a received message by it's receiptHandle.

Throws error if queue could not be found.

```js
return deleteMessage('my-queue', message.ReceiptHandle);
```

## poll(queueName, handler, options = {})

Keeps polling for SQS messages and executes a `handler` function for each SQS message received.

The `handler` function must return a promise. After the promise is resolved it automatically deletes the message from the SQS queue. If the promise returns `false` polling stops after deleting the message.

When the message could not be processed successfully it will be retried or moved to a dead-letter queue depending on your SQS settings. Any error thrown will not stop polling; to stop the polling process `handler` must return `false`. This avoids polling to stop unexpectedly.

```js
return sqs.poll('my-queue', (message) => {}, { maxMessages: 1 });
```

## Logging

```js
import * as sqs from '@nielskrijger/sqs';

sqs.on('log', (level, message, object) => {
  console.log(`Log event: ${level}, ${message}, ${object}`);
});
```

The library returns log messages with levels `debug`, `info` and `error`.
