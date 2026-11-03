// The topics and the Kafka producer for Intake.
// Intake writes StoryChanged into readiness.story-changes. It does not know who reads it (ADR-002).

// Load the Kafka client library. logLevel lets us turn down the library's own chatter.
const { Kafka, logLevel } = require("kafkajs");

// Both topics of the system. Every Kafka service creates both at startup; repeating it is safe.
const STORY_CHANGES_TOPIC = "readiness.story-changes";
const CHECK_RESULTS_TOPIC = "readiness.check-results";

// Three partitions each. The message key is story_key, so one story's events stay in order.
const TOPICS = [
  { topic: STORY_CHANGES_TOPIC, numPartitions: 3, replicationFactor: 1 },
  { topic: CHECK_RESULTS_TOPIC, numPartitions: 3, replicationFactor: 1 }
];

// Wait a number of milliseconds.
function pause(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// Build a publisher. Options: broker, clientId, log.
function createPublisher(options) {
  // Create the client the Lab2 way. retry makes the library try again on its own first.
  const kafka = new Kafka({
    clientId: options.clientId,
    brokers: [options.broker],
    logLevel: logLevel.ERROR,
    retry: { initialRetryTime: 300, retries: 20 },
    // Send the library's own lines through our log helper, so every line has ts, service, level and event.
    logCreator: function () {
      return function (entry) {
        options.log({ level: entry.level <= logLevel.ERROR ? "error" : "warn", event: "kafka_client_logged", namespace: entry.namespace, message: entry.log.message, error: entry.log.error });
      };
    }
  });
  // A producer writes new lines into a topic.
  const producer = kafka.producer();
  // Is the producer connected and are the topics there?
  let ready = false;

  // If the connection drops, say so; /ready answers 503 until it is back.
  producer.on(producer.events.DISCONNECT, function () {
    ready = false;
  });

  // Connect, patiently. Keep trying until the broker answers; never exit.
  async function connect() {
    for (let attempt = 1; ; attempt++) {
      try {
        // Create both topics. waitForLeaders means "wait until they can take messages".
        const admin = kafka.admin();
        await admin.connect();
        await admin.createTopics({ waitForLeaders: true, topics: TOPICS });
        await admin.disconnect();
        // Open the connection for writing.
        await producer.connect();
        ready = true;
        options.log({ level: "info", event: "kafka_connected", broker: options.broker, topic: STORY_CHANGES_TOPIC });
        return;
      } catch (err) {
        // Not there yet. Wait two seconds and try again.
        options.log({ level: "warn", event: "kafka_connect_failed", attempt: attempt, message: String(err.message) });
        await pause(2000);
      }
    }
  }

  // Write one StoryChanged, keyed by story_key.
  async function publish(event) {
    await producer.send({
      topic: STORY_CHANGES_TOPIC,
      messages: [{ key: event.story_key, value: JSON.stringify(event) }]
    });
    // A send that worked proves the connection is up.
    ready = true;
  }

  // Close the connection politely.
  async function disconnect() {
    ready = false;
    await producer.disconnect();
  }

  return {
    connect: connect,
    publish: publish,
    disconnect: disconnect,
    isReady: function () { return ready; }
  };
}

module.exports = { createPublisher: createPublisher, STORY_CHANGES_TOPIC: STORY_CHANGES_TOPIC, CHECK_RESULTS_TOPIC: CHECK_RESULTS_TOPIC };
