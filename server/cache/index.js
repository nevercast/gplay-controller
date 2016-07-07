"use strict";

/* Cache module */
const Promise = require('bluebird');
const stream = require('stream');
const path = require('path');
const fdb = require('flat-file-db');
const fs = require('fs');
const crypto = require('crypto');
const memoize = require('memoizee');
const stat = Promise.promisify(fs.stat);
const mkdirp = Promise.promisify(require('mkdirp'));

class Cache {
    constructor(cachePath, producerFn) {
        console.log('Preparing cache', cachePath);
        this.cachePath = cachePath;
        this.producer = producerFn;
        this.index = fdb(path.join(this.cachePath, 'index.db'));
        this.isReady = false;
        this.index.on('open',() => this._ready());
        this.describeCacheFile = memoize((id) => {
            /* Create SHA from id */
            const sha = crypto.createHash('sha256');
            sha.update(id);
            const hash = sha.digest('hex');
            const cachePath = path.join(this.cachePath, 'data', hash.substring(0, 2), hash.substring(2, 4));
            const cacheFile = path.join(cachePath, hash.substring(4));
            return {
                path: cachePath,
                file: cacheFile
            };
        }, {maxHit: 200, length: 1});
    }

    _ready() {
        console.log('Cache ready.', this.itemCount(), 'items,', this.dbSize(), 'bytes');
    }

    itemCount() {
        return this.index.keys().length;
    }

    dbSize() {
        let size = 0;
        this.index.keys().forEach((key) => {
            size += this.index.get(key).size;
        });
        return size;
    }

    purge(opts) {
        /* Cleans up the DB */
    }

    produce(id) {
        // Will attempt to find record in cache, otherwise use the producer to create it.
        if(this.index.has(id)) {
            let record = this.index.get(id);
            console.log('Cache Hit', id, '=>', record.path);
            record.hit = new Date().getTime();
            this.index.put(id, record);
            return Promise.resolve(fs.createReadStream(record.path));
        } else {
            const cacheEntry = this.describeCacheFile(id);
            console.log('Cache Miss', id, cacheEntry.file);
            /* Ensure that the directory exists */
            return mkdirp(cacheEntry.path)
                .tap(() => console.log('Cache directory assertion'))
                .then(() => this.producer(id))
                .tap(() => console.log('Producing new file'))
                .then((downloadStream) => {
                    /* Produce the stream through a large internal buffer */
                    const producerBuffer = new stream.PassThrough({highWaterMark: 4000000});
                    downloadStream.pipe(producerBuffer);
                    downloadStream.pipe(fs.createWriteStream(cacheEntry.file))
                        .on('finish', ()=> {
                            /* Cache write complete */
                            console.log('Finished creating cache file for', id);
                            return stat(cacheEntry.file)
                                .then((stats) => stats.size)
                                .then((filesize) => {
                                   return Promise.promisify(this.index.put, {context: this.index})(id, {
                                       path: cacheEntry.file,
                                       size: filesize,
                                       hit: new Date().getTime()
                                   }).return(filesize);
                                })
                                .tap((filesize) => {
                                    console.log('Created cache index entry. Size:', filesize)
                                })
                                .catch((err) => {
                                    console.error('Error not caught writing file to cache');
                                    console.error(err);
                                })
                        });
                    console.log('Producer ready');
                    return producerBuffer;
                });
        }
    }
}

module.exports = Cache;