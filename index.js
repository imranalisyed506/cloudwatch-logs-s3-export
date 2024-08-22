const { promisify } = require('util');
const zlib = require('zlib');
const { S3Client, GetBucketLocationCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const setup = require('./setup.js');

const gunzip = promisify(zlib.gunzip);
const gzip = promisify(zlib.gzip);

exports.handler = async function(args, context) {
    "use strict";
    const callback = function(err, result) {
        if (err) {
            console.log("'" + args.operation + "' failed. Error: " + JSON.stringify(err));
            return context.fail(JSON.stringify(err));
        }
        console.log("Returning: " + JSON.stringify(result));
        return context.succeed(result);
    };

    switch (args.operation) {
        case 'processLogs':
            return handleProcessLogs(args.data, callback);
        case 'createSource':
            return setup.createSource(args.data, callback);
        case 'deleteSource':
            return setup.deleteSource(args.data, callback);
        default:
            return context.fail("Unsupported operation: '" + args.operation + "'.");
    }
};

async function handleProcessLogs(args, resultCallback) {
    "use strict";
    const s3Client = new S3Client({ region: args.awsRegion });
    try {
        const data = await s3Client.send(new GetBucketLocationCommand({ Bucket: args.s3BucketName }));
        const endpoint = getS3Endpoint(data.LocationConstraint || args.awsRegion);
        s3Client.config.endpoint = `https://${endpoint}`;
        await processLogs(args, s3Client, resultCallback);
    } catch (err) {
        console.log("handleProcessLogs Err", JSON.stringify(err));
        resultCallback(err);
    }
}

async function processLogs(args, s3Client, resultCallback) {
    "use strict";
    console.log("Processing '" + args.records.length + "' records.",JSON.stringify(args.records));

    const getMessagePromises = args.records.map(record => getMessages(args.logFormat, record));

    try {
        const results = await Promise.all(getMessagePromises);
        let data = "";
        for (let i = 0; i < results.length; i++) {
            data += results[i];
        }
        const objectName = getObjectName(args.awsRegion, args.s3LogFilePrefix, args.logFormat);
        await uploadData(data, args.awsRegion, args.s3BucketName, objectName, s3Client);
        resultCallback(null);
    } catch (err) {
        resultCallback(err);
    }
}

async function getMessages(logFormat, record) {
    "use strict";
    try {
        const result = await gunzip(Buffer.from(record.kinesis.data, 'base64'));

        const data = JSON.parse(result.toString('ascii'));
        if (!data.hasOwnProperty("messageType") || data.messageType !== "DATA_MESSAGE") {
            console.log("Invalid message received. Skip processing. messageType: " + result.messageType);
            return "";
        }

        const logEvents = data.logEvents;
        let logs = "";

        switch(logFormat) {
            case "AWS VPC Flow Logs":
                logEvents.forEach(function (log) {
                    const timestamp = log.message.split(' ')[10];
                    logs += "VPC Flow Log Record: " + timestamp + " " + log.message + "\n";
                });
                break;
            case "AWS Lambda":
                logEvents.forEach(function (log) {
                    const date = new Date(log.timestamp);
                    logs += "Lambda Log Record: [" + date.toISOString() + "] - " + log.message + "\n\n";
                });
                break;
            case "AWS IoT":
                logEvents.forEach(function (log) {
                    logs += "IoT Log Record: " + log.message + "\n";
                });
                break;
            default:
                logEvents.forEach(function (log) {
                    const date = new Date(log.timestamp);
                    logs += "Custom CloudWatch Log Record: [" + date.toISOString() + "] - " + log.message + "\n\n";
                });
                break;
        }
        return logs;
    } catch (err) {
        console.log("Failed to uncompress data. Record: '" + JSON.stringify(record) +
                    "'. Error: " + JSON.stringify(err));
        return "";
    }
}

async function uploadData(data, awsRegion, s3BucketName, objectName, s3Client) {
    "use strict";
    if (!data || !data.length) { return; }

    console.log("Uploading data. Region: %s, BucketName: %s, ObjectName: %s",
        awsRegion, s3BucketName, objectName);

    try {
        const compressedData = await gzip(data);

        const params = {
            Bucket: s3BucketName,
            Key: objectName,
            Body: compressedData,
            ContentType: "application/json",
            ContentEncoding: "gzip"
        };

        await s3Client.send(new PutObjectCommand(params));
        console.log("Successfully persisted '" + getObjectUrl(objectName, s3BucketName) + "'.");
    } catch (err) {
        console.log("Failed to persist '" + objectName + "' object to '" + s3BucketName + "' bucket. " +
                    "Error: " + JSON.stringify(err));
        throw err;
    }
}

function getObjectName(awsRegion, s3LogFilePrefix, logFormat) {
    "use strict";
    const now = new Date();
    const timeString = now.getFullYear() + '-' +
        ("0" + (now.getMonth() + 1)).slice(-2) + '-' +
        ("0" + (now.getDate() + 1)).slice(-2) + '-' +
        ("0" + (now.getHours() + 1)).slice(-2) + '-' +
        ("0" + (now.getMinutes() + 1)).slice(-2) + '-' +
        ("0" + (now.getSeconds() + 1)).slice(-2);
    const suffix = (Math.random().toString(36) + '0000000000000000').slice(2, 18);
    const prefix = s3LogFilePrefix === "" ? "" : s3LogFilePrefix;
    return `${prefix}${timeString}-${suffix}.json.gz`;
}

function getS3Endpoint(region) {
    "use strict";
    if (!region || region === 'us-east-1' || region === '') {
        return 's3.amazonaws.com';
    }
    return `s3-${region}.amazonaws.com`;
}

function getObjectUrl(objectName, s3BucketName) {
    "use strict";
    return `https://s3.amazonaws.com/${s3BucketName}/${objectName}`;
}