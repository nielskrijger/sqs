# SQS

A wrapper for [AWS SDK](http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/SQS.html), providing promises and a set of convenience methods.

**NOTE**: this library is not very customizable nor will it be, its intent is to serve as a standard for my personal projects. There are only few tests because its use is extensively tested in component tests.

## init(options)

Run `init(options)` before executing any statements.

```js
import * as sqs from '@nielskrijger/sqs';

sqs.connect({
  region: 'eu-west-1',
});
```

Other connection options can be found in the [AWS SQS](http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/SQS.html) documentation.

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

Returns an array with all messages received or an empty array when none were available. Messages that do not contain a valid JSON message body are silently ignored and as a result will re-appear in the SQS queue after their visibility timeout has expired.

```js
return sqs.receiveMessages('my-queue').then((messages) => {
  console.log('messages');
}
```

Option          | Default | Description
----------------|---------|-----------------------------
maxMessages     |       1 | Maximum number of messages to retrieve. Between 1-10.
waitTime        |       0 | Number of seconds a receiveMessage call will wait for a message to arrive. An integer from 0 to 20. When 0 polling switches to short polling which returns immediately.

## poll(queueName, handler, options = {})

Keeps polling for SQS messages and executes a `handler` function for all SQS messages received.

The `handler` function must return a promise. After the promise is resolved it automatically deletes the messages from the SQS queue. If the promise returns `false` polling stops after deleting the message. Throw an error to prevent deleting the message but continue polling. This avoids polling to stop unexpectedly.

When the message could not be processed successfully it will be retried or moved to a dead-letter queue depending on your SQS settings.

```js
function handler(messages) {
  messages.forEach((message) => console.log(message.ReceiptHandle));
  return Promise.resolve();
}
return sqs.poll('my-queue', handler, { maxMessages: 10 });
```

Option           | Default | Description
-----------------|---------|-----------------------------
stopWhenDepleted |   false | Stops polling when no more messages are being received.
maxMessages      |       1 | Maximum number of messages to retrieve. Between 1-10.
waitTime         |       0 | Number of seconds a receiveMessage call will wait for a message to arrive. An integer from 0 to 20. When 0 polling switches to short polling which returns immediately.

## deleteMessage(queueName, receiptHandle)

Deletes a received message by its `ReceiptHandle`. Deleting a message acknowledges SQS the message has been processed and can be deleted from the queue.

```js
return deleteMessage('my-queue', message.ReceiptHandle);
```

## Logging

```js
import * as sqs from '@nielskrijger/sqs';

sqs.on('log', (level, message, object) => {
  console.log(`Log event: ${level}, ${message}, ${object}`);
});
```

The library returns log messages with levels `debug`, `info` and `error`.

## Tests

```sh
$ export AWS_ACCESS_KEY_ID="AKIAIOSFODNN7EXAMPLE"
$ export AWS_SECRET_ACCESS_KEY="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
$ export AWS_DEFAULT_REGION="us-west-1"
$ npm test
```

The test will create an SQS queue 'nielskrijger-sqs-tst' if it does not already exists.
