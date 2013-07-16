module.exports = middleware = function(options){
    var url = require('url');
    var child_process = require('child_process');
    var spawn = child_process.spawn;
    var path = require('path');
    var fs = require('fs');

    var app_dir = path.dirname(require.main.filename);
    var middleware_dir = path.join(app_dir, '.express-git');
    var cache_dir = path.join(middleware_dir, 'cache');
    var repository_dir = path.join(middleware_dir, 'content.git');

    // Only log if in debug mode
    var log = function(key, val, type) {
        if(options.debug || type === 'error') {
            var colors = {
                'log': '90',
                'info': '94',
                'error': '91',
                'warn': '93'
            };
            if (['log', 'info', 'error', 'warn'].indexOf(type) < 0) {
                type = 'log';
            }
            console[type]('  \033['+ colors[type] +'m%s :\033[0m \033[36m%s\033[0m', key, val);
        }
    };

    var log_stream = function(key, stream, type) {
        stream.on('data', function(data) {
            log(key, data, type);
        });
        stream.on('end', function() {
            log(key, '----=[ END ]=----', type);
        });
    };

    var res_nocache = function(res) {
        res.setHeader('Expires', 'Fri, 01 Jan 1980 00:00:00 GMT');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Cache-Control', 'no-cache, max-age=0, must-revalidate');
    };

    var services = [
        { 'method': 'GET', 'pattern': new RegExp('/HEAD$'), 'imp': get_head },
        { 'method': 'GET', 'pattern': new RegExp('/info/refs$'), 'imp': get_info_refs },
        { 'method': 'GET', 'pattern': new RegExp('/objects/info/alternates$'), 'imp': get_text_file },
        { 'method': 'GET', 'pattern': new RegExp('/objects/info/http-alternates$'), 'imp': get_text_file },
        { 'method': 'GET', 'pattern': new RegExp('/objects/info/packs$'), 'imp': get_info_packs },
        { 'method': 'GET', 'pattern': new RegExp('/objects/[0-9a-f]{2}/[0-9a-f]{38}$'), 'imp': get_loose_object },
        { 'method': 'GET', 'pattern': new RegExp('/objects/pack/pack-[0-9a-f]{40}\\.pack$'), 'imp': get_pack_file },
        { 'method': 'GET', 'pattern': new RegExp('/objects/pack/pack-[0-9a-f]{40}\\.idx$'), 'imp': get_idx_file },
        { 'method': 'POST', 'pattern':  new RegExp('/git-upload-pack$'), 'imp': service_rpc },
        { 'method': 'POST', 'pattern':  new RegExp('/git-receive-pack$'), 'imp': service_rpc }
    ];

    function get_head() {
        return 'get_head is not implemented';
    }

    function get_info_refs(repository, service_name, req, res, options) {
        res_nocache(res);
        res.setHeader('Content-Type', 'application/x-'+ service_name +'-advertisement');

        var packet = '# service='+ service_name +'\n';
        var length = packet.length + 4;
        prefix = String('0000' + length.toString(16)).slice(-4);
        res.write(prefix + packet + '0000');

        var git = spawn(service_name, ['--stateless-rpc', '--advertise-refs', repository]);
        git.stdout.pipe(res);

        //log_stream('get_info_refs::req', req, 'info')
        //log_stream('get_info_refs::git', git.stdout, 'info');
        log_stream('get_info_refs::git', git.stderr, 'warn');
    }

    function get_text_file() {
        return 'get_text_file is not implemented';
    }

    function get_info_packs() {
        return 'get_info_packs is not implemented';
    }

    function get_loose_object() {
        return 'get_loose_object is not implemented';
    }

    function get_pack_file() {
        return 'get_pack_file is not implemented';
    }

    function get_idx_file() {
        return 'get_idx_file is not implemented';
    }

    function service_rpc(repository, service_name, req, res, options) {
        res_nocache(res);
        res.setHeader('Content-Type', 'application/x-'+ service_name +'-result');

        var git = spawn(service_name, ['--stateless-rpc', repository]);
        req.pipe(git.stdin);
        git.stdout.pipe(res);

        //log_stream('service_rpc::req', req, 'info')
        //log_stream('service_rpc::git', git.stdout, 'info')
        log_stream('service_rpc::git', git.stderr, 'warn');
    }

    function checkout_ref(repository, ref, callback) {
        var git = spawn('git', [
            '--git-dir', repository,
            'rev-list',
            '-n', '1',
            ref
        ]);

        ref = '';
        git.stdout.on('data', function(data) {
            log('checkout_ref::git_rev_list', data, 'info');
            ref += data;
        });
        git.stdout.on('end', function() {
            ref = ref.trim();
            log('checkout_ref::git_rev_list', 'end', 'info');
            var work_dir = path.join(cache_dir, ref);

            // checkout ref
            fs.mkdir(work_dir, function(err) {
                if (err) {
                    log('checkout_ref::git_rev_list::mkdir', err, 'warn');
                    return callback(ref);
                }
                log('checkout_ref::git_rev_list', [
                    'git',
                    '--git-dir', repository,
                    '--work-tree', work_dir,
                    'checkout',
                    '-f',
                    '--', '"*/*"',
                    ref
                ], 'info');

                var git = spawn('git', [
                    '--git-dir', repository,
                    '--work-tree', work_dir,
                    'checkout',
                    '-f',
                    ref
                ]);
                git.stdout.on('end', function() {
                    log('checkout_ref::git_checkout', 'end', 'info');
                    fs.readdir(work_dir, function(err, files) {
                        log('checkout_ref::git_checkout::readdir', files, 'info');
                        if (err) {
                            log('checkout_ref::git_checkout::readdir', err, 'warn');
                            return callback(ref);
                        }
                        // symlink each dir
                        for (var i = 0; i < files.length; i++) {
                            var file = files[i];
                            var source_dir = path.join(work_dir, file);
                            var target_dir = path.join(app_dir, file);
                            source_dir = path.relative(target_dir, source_dir);
                            target_dir = path.join(app_dir, file, ref);
                            fs.symlinkSync(source_dir, target_dir);
                        }
                        callback(ref);
                    });
                });
                log_stream('checkout_ref::git_checkout', git.stderr, 'warn');
            });

        });
        log_stream('checkout_ref::git_rev_list', git.stderr, 'warn');
    }


    return function(req, res, next) {
        var repository = options.repository || repository_dir;
        var branch = req.headers['x-git-ref'] || options.branch || 'master';

        var pathname = url.parse(req.url).pathname;
        var service = null;
        for (var i = 0; i < services.length; i++) {
            service = services[i];
            var index;
            if ((index = pathname.search(service.pattern)) != -1) {
                if (req.method.toUpperCase() != service.method) { return next(); }
                var req_dir = pathname.substring(0, index);
                if (req_dir.length > 0)
                    repository = path.join(app_dir, req_dir);
                service_name = req.query.service || pathname.substring(index+1);
                break;
            }
            service = null;
        }

        if (service) {
            service.imp(repository, service_name, req, res, options);
        } else {
            checkout_ref(repository, branch, function(ref) {
                req.url = '/'+ ref + req.url;
                log('git-middleware', req.url, 'info');
                next();
            });
        }
    };
};
