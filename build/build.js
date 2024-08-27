/*
 * Build dependencies and configuration
 */
const async             = require('async');
const fs                = require('fs');
const glob              = require('glob-all');
const mkdirp            = require('mkdirp');
const path              = require('path');
const prompt            = require('prompt');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { fromIni }       = require('@aws-sdk/credential-providers');
const pkg               = require('../package.json');
const execFile          = require('child_process').execFile;

const base              = pkg.folders.jsSource;
const deploy            = pkg.folders.build + pkg.name + '/';
const awsRegions = [
    'ap-northeast-1',
    'ap-northeast-2',
    'ap-south-1',
    'ap-southeast-1',
    'ap-southeast-2',
    'ca-central-1',
    'eu-central-1',
    'eu-west-1',
    'eu-west-2',
    'eu-west-3',
    'sa-east-1',
    'us-east-1',
    'us-east-2',
    'us-west-1',
    'us-west-2'
];

console.log('Building Lambda package to ' + deploy + ', base = ' + base);

/*
 * Source location mappings for glob
 */
const source = {
    "application": [
        `${base}**/*.js`,
        `!${base}build/**`,
        `!${base}git-hooks/**`,
        `!${base}node_modules/**`,
        `!${base}target/**`,
        `!${base}utility/**`,
        `!${base}deployment/**`,
        `!${base}configuration/**`
    ],
    "config": [
        `${base}package.json`
    ]
};

/*
 * Create the node_modules directory so that it exists for installation regardless of module definitions for deployment
 */
async.waterfall([
    function(callback) {
        mkdirp(deploy + 'node_modules/', function (err) {
            if (err) return callback(err);
            
            fs.createReadStream('./package.json').pipe(fs.createWriteStream('./target/cloudwatch-logs-s3-export/package.json'));
            execFile('npm', ['install', '--only=production', '--prefix', 'target/cloudwatch-logs-s3-export'], function(err, stdout) {
                if (err) {
                    console.log("npm install failed. Error: " + err);
                    return callback(err);
                } else {
                    return callback(null);
                }
            });
        });
    },
    function(callback) {
        /*
         * Execute glob based distribution of source files
         */
        async.each(Object.getOwnPropertyNames(source), function(section, eachCallback) {
            glob.sync(source[section]).forEach(function(item) {
                mkdirp(path.dirname(item.replace(base, deploy)), function (err) {
                    if (err) {
                        console.log("Error: " + JSON.stringify(err));
                        return eachCallback(err);
                    } else {
                        const stream = fs.createReadStream(item).pipe(fs.createWriteStream(item.replace(base, deploy)));
                    }
                });
            });
            return eachCallback(null);
        }, function(err) {
            return callback(null);
        });
    },
    function(callback) {
        const fileName = 'cloudwatch-logs-s3-export-' + pkg.version + '.zip';
        const zipped   = '../' + fileName;
        process.chdir('target/cloudwatch-logs-s3-export');
        execFile('zip', ['-r', '-X', zipped, './'], function(err, stdout) {});
        process.chdir('../../');

        // Prompt for profile to use to deploy our package to S3
        const promptSchema = {
            properties: {
                profile: {
                    required: true
                },
                bucketPrefix: {
                    description: 'Provide bucket name prefix to upload files. The region name will be appended to the name you provide.',
                    required: true,
                    default: 'alertlogic-public-repo'
                }
            }
        };

        prompt.start();
        prompt.get(promptSchema, function (err, input) {
            if (err) { return onErr(err); }

            const code = fs.readFileSync(path.resolve(__dirname, '../target/' + fileName));

            async.eachSeries(awsRegions, function(region, seriesCallback) {
                const bucketName = `${input.bucketPrefix}.${region}`;
                const endpoint = getS3Endpoint(region);

                console.log(`Uploading '${fileName}' to '${bucketName}' bucket at endpoint '${endpoint}'.`);

                const s3Client = new S3Client({
                    region: region,
                    endpoint: `https://${endpoint}`,
                    credentials: fromIni({ profile: input.profile })
                });

                const params = {
                    Bucket: bucketName,
                    Key: fileName,
                    Body: code,
                    ContentType: "application/binary"
                };

                s3Client.send(new PutObjectCommand(params))
                    .then(() => {
                        console.log(`Successfully persisted '${fileName}'.`);
                        seriesCallback(null);
                    })
                    .catch((err) => {
                        console.log(`Failed to persist '${fileName}' object to '${bucketName}' bucket. Error: ${JSON.stringify(err)}`);
                        seriesCallback(err);
                    });
            }, function(err) {
                if (err) {
                    console.log("Upload to S3 failed. Error: " + JSON.stringify(err));
                    return callback(err);
                } else {
                    console.log("Successfully uploaded to S3.");
                    return updateCFTemplate(input.bucketPrefix, fileName, callback);
                }
            });
        });
    }
], function (err) {
    return onErr(err)
});

function updateCFTemplate(bucketPrefix, objectName, resultCallback) {
    const jsonTemplateFile = "configuration/cloudformation/cwl-s3-export.template";
    console.log(`Updating '${jsonTemplateFile}'.`);
    async.waterfall([
        function(callback) {
            fs.readFile(jsonTemplateFile, { encoding: 'utf8' }, function (err, data) {
                if (err) { return callback(err); }
                const json = JSON.parse(data);
                return callback(null, json);
            });
        },
        function(template, callback) {
            let modified = false;
            if (template.Parameters.LambdaS3BucketNamePrefix.Default !== bucketPrefix) {
                template.Parameters.LambdaS3BucketNamePrefix.Default = bucketPrefix;
                modified = true;
            }
            if (template.Parameters.LambdaPackageName.Default !== objectName) {
                template.Parameters.LambdaPackageName.Default = objectName;
                modified = true;
            }
            return callback(null, modified ? template : null);
        },
        function (template, callback) {
            if (template) {
                return fs.writeFile(jsonTemplateFile, JSON.stringify(template, null, 4), callback);
            } else {
                return callback(null);
            }
        }
    ], function (err) {
        return resultCallback(err);
    });
}

function onErr(err) {
    if (err !== null) {
        console.log(err);
        return 1;
    }
}

function getS3Endpoint(region) {
    if (!region || region === 'us-east-1' || region === '') {
        return 's3.amazonaws.com';
    }
    return `s3-${region}.amazonaws.com`;
}
