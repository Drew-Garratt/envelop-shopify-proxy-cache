import { envelop, useLogger, useAsyncSchema } from '@envelop/core';
import { loadSchema } from '@graphql-tools/load';
import { UrlLoader } from '@graphql-tools/url-loader';
import fastify from 'fastify';
import { GraphQLSchema } from 'graphql';
import { processRequest, getGraphQLParameters } from 'graphql-helix';
import { createInMemoryCache, useResponseCache } from '@envelop/response-cache';
import { createRedisCache } from '@envelop/response-cache-redis';

const devMode = process.env["NODE_ENV"] === 'development'

require('dotenv').config()

// Create a proxy of the the Shopify GraphQL schema that can be passed to helix
const getSchema = async (): Promise<GraphQLSchema> => {
    return await loadSchema(`https://${process.env.SHOPIFY_STORE}/api/${process.env.STOREFRONT_API_VERSION}/graphql.json`, {   // load from endpoint
        loaders: [
            new UrlLoader()
        ],
        headers: {
            "X-Shopify-Storefront-Access-Token": process.env.STOREFRONT_API_PASSWORD
        },
    });
};

// Create out cache plugin in memory for local development and redis for production
const createCache = (devMode: boolean) => {
    if (devMode) {
        return createInMemoryCache()
    }
    const Redis = require("ioredis");
    const redis = new Redis((process.env.REDIS_CONNECTION_STRING))
    return createRedisCache({ redis })
}

// Create our cache instanced based on devMode
const cache = createCache(devMode)

// Create out plugins list
const plugins = [
    useAsyncSchema(getSchema()),
    useResponseCache({
        includeExtensionMetadata: true,
        ignoredTypes: [],
        cache
    })
]

// Add logger to plugins list for local development
if (devMode) {
    plugins.push(useLogger())
}

// This creates the `getEnveloped` function for us. Behind the scenes the wrapped functions are created once, here.
const getEnveloped = envelop({plugins});

const app = fastify();

// Hello world route to confirm app is running
app.get('/', (req, res) => {
    res.send('Hello World!')
})

app.route({
    method: ['POST','GET'],
    url: '/graphql',
    async handler(req, res) {
        // Here we can pass the request and make available as part of the "context".
        // The return value is the a GraphQL-proxy that exposes all the functions.
        const { parse, validate, contextFactory, execute, schema } = getEnveloped({
            req,
        });
        const request = {
            body: req.body,
            headers: req.headers,
            method: req.method,
            query: req.query,
        };
        const { operationName, query, variables } = getGraphQLParameters(request);

        // Here, we pass our custom functions to Helix, and it will take care of the rest.
        const result = await processRequest({
            operationName,
            query,
            variables,
            request,
            schema,
            parse,
            validate,
            execute,
            contextFactory,
        });

        if (result.type === 'RESPONSE') {
            res.status(result.status);
            res.send(result.payload);
        } else {
            // You can find a complete example with Subscriptions and stream/defer here:
            // https://github.com/contrawork/graphql-helix/blob/master/examples/fastify/server.ts
            res.send({ errors: [{ message: 'Not Supported in this demo' }] });
        }
    },
});

// Configure server for local and docker env
const appPort = devMode ? 3000 : 8080
const appServer = devMode ? 'localhost' : '0.0.0.0'

app.listen(appPort, appServer, (err, address) => {
    if (err) {
        app.log.error(err)
        process.exit(1)
    }
    console.log(`GraphQL server is running at ${address}`);
});
