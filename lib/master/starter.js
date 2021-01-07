//启动器模块
var cp = require('child_process');
var logger = require('pomelo-logger').getLogger('pomelo', __filename);
var starter = module.exports;
var util = require('util');
var utils = require('../util/utils');
var Constants = require('../util/constants');
var env = Constants.RESERVED.ENV_DEV;
var os=require('os');
var cpus = {};
var pomelo = require('../pomelo');

/**
 * Run all servers
 *启动所有非master服务器
 * @param {Object} app current application  context
 * @return {Void}
 */
 starter.runServers = function(app) {
  var server, servers;
  var condition = app.startId || app.type;
  switch(condition) {
    case Constants.RESERVED.MASTER:
    break;
    case Constants.RESERVED.ALL:
      //从servermap中获取所有的server
    servers = app.getServersFromConfig();
    for (var serverId in servers) {
      this.run(app, servers[serverId]);
    }
    break;
    default:
    server = app.getServerFromConfig(condition);
    if(!!server) {
      this.run(app, server);
    } else {
      servers = app.get(Constants.RESERVED.SERVERS)[condition];
      for(var i=0; i<servers.length; i++) {
        this.run(app, servers[i]);
      }
    }
  }
};

/**
 * Run server
 *1.如果是本地进程 直接启动子进程维护 2.如果是远程进程，启动远程节点进程
 * @param {Object} app current application context
 * @param {Object} server
 * @return {Void}
 */
starter.run = function(app, server, cb) {
  env = app.get(Constants.RESERVED.ENV);
  var cmd, key;
  if (utils.isLocal(server.host)) {//判断是否是本地服务器
    var options = [];
    if (!!server.args) {
      if(typeof server.args === 'string') {
        options.push(server.args.trim());
      } else {
        options = options.concat(server.args);
      }
    }
    cmd = app.get(Constants.RESERVED.MAIN);
    options.push(cmd);
    options.push(util.format('env=%s',  env));
    for(key in server) {
      if(key === Constants.RESERVED.CPU) {
        cpus[server.id] = server[key];
      }
      options.push(util.format('%s=%s', key, server[key]));
    }
    //构造好options字段后执行启动逻辑
    starter.localrun(process.execPath, null, options, cb);
  } else {//不是本地服务器
    cmd = util.format('cd "%s" && "%s"', app.getBase(), process.execPath);
    var arg = server.args;
    if (arg !== undefined) {
      cmd += arg;
    }
    cmd += util.format(' "%s" env=%s ', app.get(Constants.RESERVED.MAIN), env);
    for(key in server) {
      if(key === Constants.RESERVED.CPU) {
        cpus[server.id] = server[key];
      }
      cmd += util.format(' %s=%s ', key, server[key]);
    }
    //远程启动服务器
    starter.sshrun(cmd, server.host, cb);
  }
};

/**
 * Bind process with cpu
 *
 * @param {String} sid server id
 * @param {String} pid process id
 * @param {String} host server host
 * @return {Void}
 */
starter.bindCpu = function(sid, pid, host) {
  if(os.platform() === Constants.PLATFORM.LINUX && cpus[sid] !== undefined) {
    if (utils.isLocal(host)) {
      var options = [];
      options.push('-pc');
      options.push(cpus[sid]);
      options.push(pid);
      starter.localrun(Constants.COMMAND.TASKSET, null, options);
    }
    else {
      var cmd = util.format('taskset -pc "%s" "%s"', cpus[sid], pid);
      starter.sshrun(cmd, host, null);
    }
  }
};

/**
 * Kill application in all servers
 *
 * @param {String} pids  array of server's pid
 * @param {String} serverIds array of serverId
 */
starter.kill = function(pids, servers) {
  var cmd;
  for(var i = 0; i < servers.length; i++) {
    var server = servers[i];
    if(utils.isLocal(server.host)) {
      var options = [];
      if(os.platform() === Constants.PLATFORM.WIN) {
        cmd = Constants.COMMAND.TASKKILL;
        options.push('/pid');
        options.push('/f');
      } else {
        cmd = Constants.COMMAND.KILL;
        options.push(-9);
      }
      options.push(pids[i]);
      starter.localrun(cmd,null,options);
    } else {
      if(os.platform() === Constants.PLATFORM.WIN) {
        cmd = util.format('taskkill /pid %s /f', pids[i]);
      } else {
        cmd = util.format('kill -9 %s', pids[i]);
      }
      starter.sshrun(cmd, server.host);
    }
  }
};

/**
 * Use ssh to run command.
 *
 * @param {String} cmd command that would be executed in the remote server
 * @param {String} host remote server host
 * @param {Function} cb callback function
 *
 */
starter.sshrun = function(cmd, host, cb) {
  var args = [];
  args.push(host);
  var ssh_params = pomelo.app.get(Constants.RESERVED.SSH_CONFIG_PARAMS);
  if(!!ssh_params && Array.isArray(ssh_params)) {
    args = args.concat(ssh_params);
  }
  args.push(cmd);

  logger.info('Executing ' + cmd + ' on ' + host + ':22');
  //在命令前面加上ssh后 在远端执行cmd命令,然后生成一个子进程用于启动server
  spawnProcess(Constants.COMMAND.SSH, host, args, cb);
  return;
};

/**
 * Run local command.
 *
 * @param {String} cmd
 * @param {Callback} callback
 *
 */
starter.localrun = function (cmd, host, options, callback) {
  logger.info('Executing ' + cmd + ' ' + options + ' locally');
  spawnProcess(cmd, host, options, callback);
};

/**
 * Fork child process to run command.
 *  启动一个子进程来运行启动命令
 * @param {String} command
 * @param {Object} options
 * @param {Callback} callback
 *
 */
var spawnProcess = function(command, host, options, cb) {
  var child = null;

  if(env === Constants.RESERVED.ENV_DEV) {
    child = cp.spawn(command, options);
    var prefix = command === Constants.COMMAND.SSH ? '[' + host + '] ' : '';

    child.stderr.on('data', function (chunk) {
      var msg = chunk.toString();
      process.stderr.write(msg);
      if(!!cb) {
        cb(msg);
      }
    });

    child.stdout.on('data', function (chunk) {
      var msg = prefix + chunk.toString();
      process.stdout.write(msg);
    });
  } else {
    child = cp.spawn(command, options, {detached: true, stdio: 'inherit'});
    child.unref();
  }

  child.on('exit', function (code) {
    if(code !== 0) {
      logger.warn('child process exit with error, error code: %s, executed command: %s', code,  command);
    }
    if (typeof cb === 'function') {
      cb(code === 0 ? null : code);
    }
  });
};
