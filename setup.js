var defenderApi = require('./utilities/defender_api_client.js'),
    { S3Client,
        GetBucketLocationCommand,
        GetBucketLifecycleConfigurationCommand,
        PutBucketLifecycleConfigurationCommand,
        DeleteBucketLifecycleConfigurationCommand
    } = require('@aws-sdk/client-s3');

exports.createSource = async function (args, callback) {
    "use strict";
    var sourceName = args.name,
        sourceType = args.type,
        params = {
            customerId: args.customerId,
            auth: args.auth,
            args: [
                { name: 'type', value: sourceType },
                { name: 'name', value: sourceName }
            ]
        };

    if (args.customerId === "" || args.auth === "") {
        return callback(null, { id: "" });
    }

    try {
        const lifeCycleParams = {
            name: args.name + "-rule",
            bucket: args.s3.bucket
        };
        await new Promise((resolve, reject) => {
            updateBucketLifeCycle(lifeCycleParams, "add", (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });

        const result = await new Promise((resolve, reject) => {
            defenderApi.getSource(params, (err, result) => {
                if (err) {
                    console.log("Failed to get S3 sources. Error: '" + JSON.stringify(err) + "'");
                    reject(err);
                } else {
                    resolve(result);
                }
            });
        });

        var r = JSON.parse(result);
        if (r.sources.length) {
            console.log("Source '" + sourceName + "' already exists.");
            console.log("Source: " + JSON.stringify(r.sources[0], null, 3));
            if (r.sources[0].hasOwnProperty(sourceType)) {
                return callback(null, { id: r.sources[0][sourceType].id });
            } else {
                await new Promise((resolve, reject) => {
                    createSourceImpl(args, (err, result) => {
                        if (err) {
                            console.log("Failed to create source. Error: '" + JSON.stringify(err) + "'");
                            reject(err);
                        } else {
                            console.log("Successfully created source. Result: '" + JSON.stringify(result) + "'");
                            resolve(result);
                        }
                    });
                });
            }
        } else {
            await new Promise((resolve, reject) => {
                createSourceImpl(args, (err, result) => {
                    if (err) {
                        console.log("Failed to create source. Error: '" + JSON.stringify(err) + "'");
                        reject(err);
                    } else {
                        console.log("Successfully created source. Result: '" + JSON.stringify(result) + "'");
                        resolve(result);
                    }
                });
            });
        }
    } catch (err) {
        return callback(err);
    }

    return callback(null, { successful: true });
};
exports.deleteSource = async function (args, callback) {
    "use strict";
    var sourceName = args.name,
        sourceType = args.type,
        params = {
            customerId: args.customerId,
            auth: args.auth,
            args: [
                { name: 'type', value: sourceType },
                { name: 'name', value: sourceName }
            ]
        };

    if (args.customerId === "" || args.auth === "") {
        return callback(null, { id: "" });
    }

    try {
        var lifeCycleParams = {
            name: args.name + "-rule",
            bucket: args.s3.bucket
        };
        await new Promise((resolve, reject) => {
            updateBucketLifeCycle(lifeCycleParams, "remove", err => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });

        const result = await new Promise((resolve, reject) => {
            defenderApi.getSource(params, (err, result) => {
                if (err) {
                    console.log("Failed to get S3 sources. Error: '" + JSON.stringify(err) + "'");
                    reject(err);
                } else {
                    resolve(result);
                }
            });
        });

        var r = JSON.parse(result);
        if (!r.sources.length) {
            return callback(null, { id: "" });
        }

        for (var i = 0; i < r.sources.length; i++) {
            if (r.sources[0].hasOwnProperty(sourceType)) {
                var source = r.sources[0][sourceType];
                args['sourceId'] = source.id;
                args['credentialId'] = source.credential_id;
                args['policyId'] = source.policy_id;
                return deleteSourceImpl(args, callback);
            }
        }

        return callback(null, { id: "" });
    } catch (err) {
        return callback(err);
    }
};

async function createSourceImpl(args, resultCallback) {
    "use strict";
    console.log("Creating '" + args.name + "' source of '" + args.type + "' type.");
    try {
        var credentialId = await new Promise((resolve, reject) => {
            getCredentials(args, true, (err, id) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });

        var policyId = await new Promise((resolve, reject) => {
            getPolicy(args, true, (err, id) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });

        var result = await new Promise((resolve, reject) => {
            doCreateSource(args, credentialId, policyId, (err, res) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });

        resultCallback(null, result);
    } catch (err) {
        resultCallback(err, null);
    }
}

async function deleteSourceImpl(args, resultCallback) {
    "use strict";
    console.log("Deleting '" + args.sourceId + "' source.");
    try {
        await new Promise((resolve, reject) => {
            doDeleteSource(args, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });

        await new Promise((resolve, reject) => {
            deletePolicy(args, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });

        await new Promise((resolve, reject) => {
            deleteCredential(args, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });

        resultCallback(null, { id: args.sourceId });
    } catch (err) {
        resultCallback(err, null);
    }
}

async function getCredentials(args, createFlag, callback) {
    "use strict";
    var params = {
        customerId: args.customerId,
        auth: args.auth,
        args: [
            { name: 'type', value: args.credentials.type },
            { name: 'name', value: args.name }
        ]
    };

    try {
        const result = await new Promise((resolve, reject) => {
            defenderApi.getCredentials(params, (err, result) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });

        var r = JSON.parse(result);
        if (r.credentials.length) {
            var id = r.credentials[0][args.credentials.type].id;
            console.log("CredentialId: " + id);
            return callback(null, id);
        } else if (!createFlag) {
            return callback({ message: "Credentials object doesn't exist", code: 404 });
        }
        return createCredentials(args, callback);
    } catch (err) {
        return callback(err);
    }
}

async function createCredentials(args, callback) {
    "use strict";
    var params = {
        customerId: args.customerId,
        auth: args.auth,
        name: args.name,
        credentials: args.credentials
    };

    try {
        const result = await new Promise((resolve, reject) => {
            defenderApi.createCredentials(params, (err, result) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });

        var id = JSON.parse(result)[params.credentials.type].id;
        console.log("Created new credentials object: " + id);
        return callback(null, id);
    } catch (err) {
        return callback(err);
    }
}

async function deleteCredential(args, callback) {
    "use strict";
    var params = {
        customerId: args.customerId,
        auth: args.auth,
        id: args.credentialId
    };

    try {
        await new Promise((resolve, reject) => {
            defenderApi.deleteCredential(params, (err, result) => {
                if (err) {
                    console.log("Failed to delete credential '" + args.credentialId + "'. Error: " + JSON.stringify(err));
                    reject(err);
                } else {
                    resolve();
                }
            });
        });

        return callback(null);
    } catch (err) {
        return callback(err);
    }
}
async function getPolicy(args, createFlag, callback) {
    "use strict";
    var params = {
        customerId: args.customerId,
        auth: args.auth,
        args: [
            { name: 'type', value: args.type },
            { name: 'name', value: args.name }
        ]
    };

    try {
        const result = await new Promise((resolve, reject) => {
            defenderApi.getPolicy(params, (err, result) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });

        var r = JSON.parse(result);
        if (r.policies.length) {
            var id = r.policies[0][args.type].id;
            console.log("Policy Id: " + id);
            return callback(null, id);
        } else if (!createFlag) {
            return callback({ message: "Policy object doesn't exist", code: 404 });
        }
        return createPolicy(args, callback);
    } catch (err) {
        return callback(err);
    }
}

async function createPolicy(args, callback) {
    "use strict";
    var params = {};

    switch (args.logFormat) {
        case "AWS VPC Flow Logs":
            params = {
                customerId: args.customerId,
                auth: args.auth,
                name: args.name,
                type: args.type,
                policy: {
                    default: "false",
                    template_id: "BFE6243E-E57C-4ADE-B444-C5999E8FE3A7"
                }
            };
            break;
        case "AWS IoT":
            params = {
                customerId: args.customerId,
                auth: args.auth,
                name: args.name,
                type: args.type,
                policy: {
                    default: "false",
                    timestamp: {
                        format: "YYYY-MM-DD hh:mm:ss"
                    },
                    multiline: {
                        is_multiline: "false"
                    }
                }
            };
            break;
        default:
            params = {
                customerId: args.customerId,
                auth: args.auth,
                name: args.name,
                type: args.type,
                policy: args.policy
            };
    }

    console.log("Creating policy document: %s", JSON.stringify(params));
    try {
        const result = await new Promise((resolve, reject) => {
            defenderApi.createPolicy(params, (err, result) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });

        var id = JSON.parse(result)[params.type].id;
        console.log("Created new policy object: " + id);
        return callback(null, id);
    } catch (err) {
        return callback(err);
    }
}

async function deletePolicy(args, callback) {
    "use strict";
    var params = {
        customerId: args.customerId,
        auth: args.auth,
        id: args.policyId
    };

    try {
        await new Promise((resolve, reject) => {
            defenderApi.deletePolicy(params, (err, result) => {
                if (err) {
                    console.log("Failed to delete policy '" + args.policyId + "'. Error: " + JSON.stringify(err));
                    reject(err);
                } else {
                    resolve();
                }
            });
        });

        return callback(null);
    } catch (err) {
        return callback(err);
    }
}

async function doCreateSource(args, credentialId, policyId, callback) {
    "use strict";
    var params = {
        customerId: args.customerId,
        auth: args.auth,
        name: args.name,
        credentialId: credentialId,
        policyId: policyId,
        type: args.type,
        source: args[args.type]
    };
    console.log("Creating source: %s", JSON.stringify(params));
    try {
        const result = await new Promise((resolve, reject) => {
            defenderApi.createSource(params, (err, result) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });

        var newSource = JSON.parse(result)[params.type];
        console.log("Created source object. Id: '" + newSource.id + "'");
        return callback(null, { id: newSource.id });
    } catch (err) {
        return callback(err);
    }
}


async function doDeleteSource(args, callback) {
    "use strict";
    var params = {
        customerId: args.customerId,
        auth: args.auth,
        id: args.sourceId
    };

    try {
        await new Promise((resolve, reject) => {
            defenderApi.deleteSource(params, (err, result) => {
                if (err) {
                    console.log("Failed to delete source '" + args.sourceId + "'. Error: " + JSON.stringify(err));
                    reject(err);
                } else {
                    resolve();
                }
            });
        });

        return callback(null);
    } catch (err) {
        return callback(err);
    }
}

async function updateBucketLifeCycle(lifeCycleParams, operation, callback) {
    "use strict";
    console.log("updateBucketLifeCycle called... params: '%s', operation: '%s'", JSON.stringify(lifeCycleParams), operation);
    var index = lifeCycleParams.bucket.indexOf('/'),
        bucketName = lifeCycleParams.bucket.slice(0, index),
        prefix = lifeCycleParams.bucket.slice(index + 1);

    var s3 = new S3Client({ region: lifeCycleParams.region });
    try {
        await setupS3endpoint();
        const rules = await getS3Lifecycle();
        await setupLifecycle(rules);

        callback(null, `Lifecycle ${operation} operation successful`);
    } catch (err) {
        callback(err);
    }

    async function setupS3endpoint() {
        const data = await s3.send(new GetBucketLocationCommand({ "Bucket": bucketName }));
        s3.config.endpoint = `https://${getS3Endpoint(data.LocationConstraint)}`;
        console.log("Using '" + s3.config.endpoint + "' endpoint");
    }

    async function getS3Lifecycle() {
        var params = { "Bucket": bucketName },
            lifeCycleRule = {
                "Prefix": prefix,
                "Status": "Enabled",
                "Expiration": { "Days": 1 },
                "ID": lifeCycleParams.name
            };

        try {
            const data = await s3.send(new GetBucketLifecycleConfigurationCommand(params));
            for (var i = 0; i < data.Rules.length; i++) {
                var rule = data.Rules[i];
                if (rule.Prefix === lifeCycleRule.Prefix) {
                    if (operation === "add") {
                        return data.Rules;
                    } else {
                        if (rule.ID === lifeCycleRule.ID) {
                            data.Rules.splice(i, 1);
                            return data.Rules.length ? data.Rules : null;
                        } else {
                            return data.Rules;
                        }
                    }
                }
            }
            if (operation === "add") {
                data.Rules.push(lifeCycleRule);
                return data.Rules;
            } else {
                return null;
            }
        } catch (err) {
            if (err.name === "NoSuchLifecycleConfiguration") {
                return (operation === "add") ? [lifeCycleRule] : null;
            }
            console.log("Failed to get '" + bucketName + "' bucket lifecycle. " +
                "Error: " + JSON.stringify(err));
            throw err;
        }
    }

    async function setupLifecycle(rules) {
        if (!rules) {
            if (operation === "add") {
                return;
            }
            try {
                await s3.send(new DeleteBucketLifecycleConfigurationCommand({ "Bucket": bucketName }));
                console.log("Successfully deleted lifecycle configuration on '" + bucketName + "' bucket.");
            } catch (err) {
                console.log("Failed to delete lifecycle configuration on '" + bucketName + "' bucket. " +
                    "Error: " + JSON.stringify(err));
                throw err;
            }
        } else {
            var params = {
                "Bucket": bucketName,
                "LifecycleConfiguration": { "Rules": rules }
            };
            try {
                await s3.send(new PutBucketLifecycleConfigurationCommand(params));
                console.log("Successfully updated lifecycle configuration on '" + bucketName + "' bucket.");
            } catch (err) {
                console.log("Operation '" + operation + "'. Failed to set '" + bucketName + "' bucket lifecycle. " +
                    "Error: " + JSON.stringify(err));
                throw err;
            }
        }
    }
}

function getS3Endpoint(region) {
    "use strict";
    if (!region || region === 'us-east-1' || region === '') {
        return 's3.amazonaws.com';
    }
    return 's3-' + region + '.amazonaws.com';
}