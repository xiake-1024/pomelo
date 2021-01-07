var async = require('async');
var log = require('./log');
var utils = require('./utils');
var path = require('path');
var fs = require('fs');
var Constants = require('./constants');
var starter = require('../master/starter');
var logger = require('pomelo-logger').getLogger('pomelo', __filename);

/**
 * Initialize application configuration.
 */
module.exports.defaultConfiguration = function(app) {
  var args = parseArgs(process.argv);
  setupEnv(app, args);
  loadMaster(app);
  loadServers(app);
  processArgs(app, args);//解析服务器的启动命令
  configLogger(app);//配置日志管理器  ???
  loadLifecycle(app);//注册指定服务器类型中生命周期模块中的所有需要注册的函数
};

/**
 * Start servers by type.
 * 根据不同的服务器类型启动对应类型的服务器，启动后执行cb回调
 */
module.exports.startByType = function(app, cb) {
  if(!!app.startId) {
    if(app.startId === Constants.RESERVED.MASTER) {
      utils.invokeCallback(cb);
    } else {
      starter.runServers(app);
    }
  } else {
    if(!!app.type && app.type !== Constants.RESERVED.ALL && app.type !== Constants.RESERVED.MASTER) {
      starter.runServers(app);
    } else {
      utils.invokeCallback(cb);
    }
  }
};

/**
 * Load default components for application.
 * 给应用加载默认组件
 * 不同的服务器类型加载不同的组件,不同的组件通过options配置，构造不同的工厂对象
 * load的作用是构建工厂对象
 */
module.exports.loadDefaultComponents = function(app) {
  var pomelo = require('../pomelo');
  // load system default components
  if (app.serverType === Constants.RESERVED.MASTER) {
    app.load(pomelo.master, app.get('masterConfig'));
  } else {
    app.load(pomelo.proxy, app.get('proxyConfig'));
    if (app.getCurServer().port) {
      app.load(pomelo.remote, app.get('remoteConfig'));
    }
    if (app.isFrontend()) {
      app.load(pomelo.connection, app.get('connectionConfig'));
      app.load(pomelo.connector, app.get('connectorConfig'));
      app.load(pomelo.session, app.get('sessionConfig'));
      // compatible for schedulerConfig
      if(app.get('schedulerConfig')) {
        app.load(pomelo.pushScheduler, app.get('schedulerConfig'));
      } else {
        app.load(pomelo.pushScheduler, app.get('pushSchedulerConfig'));
      }
    }
    app.load(pomelo.backendSession, app.get('backendSessionConfig'));
    app.load(pomelo.channel, app.get('channelConfig'));
    app.load(pomelo.server, app.get('serverConfig'));
  }
  app.load(pomelo.monitor, app.get('monitorConfig'));
};

/**
 * Stop components.
 *
 * @param  {Array}  comps component list
 * @param  {Number}   index current component index
 * @param  {Boolean}  force whether stop component immediately
 * @param  {Function} cb
 */
module.exports.stopComps = function(comps, index, force, cb) {
  if (index >= comps.length) {
    utils.invokeCallback(cb);
    return;
  }
  var comp = comps[index];
  if (typeof comp.stop === 'function') {
    comp.stop(force, function() {
      // ignore any error
      module.exports.stopComps(comps, index + 1, force, cb);
    });
  } else {
    module.exports.stopComps(comps, index + 1, force, cb);
  }
};

/**
 * Apply command to loaded components.
 * This method would invoke the component {method} in series.
 * Any component {method} return err, it would return err directly.
 * 对所有已经加载的组件使用invoke方法(启动,启动之后)。顺序执行所有组件的方法，一个组件
 * 执行失败就执行失败
 * @param {Array} comps loaded component list
 * @param {String} method component lifecycle method name, such as: start, stop
 * @param {Function} cb
 */
module.exports.optComponents = function(comps, method, cb) {
  var i = 0;
  async.forEachSeries(comps, function(comp, done) {
    i++;
    if (typeof comp[method] === 'function') {
      comp[method](done);
    } else {
      done();
    }
  }, function(err) {
    if (err) {
      if(typeof err === 'string') {
        logger.error('fail to operate component, method: %s, err: %j', method, err);
      } else {
        logger.error('fail to operate component, method: %s, err: %j',  method, err.stack);
      }
    }
    utils.invokeCallback(cb, err);
  });
};

/**
 * Load server info from config/servers.json.
 */
var loadServers = function(app) {
  //将config/server.json中的配置加载在app.set上面。方便后面获取
  app.loadConfigBaseApp(Constants.RESERVED.SERVERS, Constants.FILEPATH.SERVER);
  var servers = app.get(Constants.RESERVED.SERVERS);//获取加载好的server.json配置
  var serverMap = {}, slist, i, l, server;
  for (var serverType in servers) {
    slist = servers[serverType];//获取不同类型的服务器列表
    for (i = 0, l = slist.length; i < l; i++) {
      server = slist[i];
      server.serverType = serverType;
      if(server[Constants.RESERVED.CLUSTER_COUNT]) {//根据需要生成的集群数量动态生成服务器信息
        utils.loadCluster(app, server, serverMap);
        continue;
      }
      serverMap[server.id] = server;
      if (server.wsPort) {
        logger.warn('wsPort is deprecated, use clientPort in frontend server instead, server: %j', server);
      }
    }
  }
  //把所有一般服务器通过server_id 平摊开  serverMap::   [{server.id=>server{}}]
  app.set(Constants.KEYWORDS.SERVER_MAP, serverMap);
};

/**
 * Load master info from config/master.json.
 */
var loadMaster = function(app) {
  app.loadConfigBaseApp(Constants.RESERVED.MASTER, Constants.FILEPATH.MASTER);//加载master服务器的配置信息
  app.master = app.get(Constants.RESERVED.MASTER);//将加载好的master.json配置，绑定在app对象上面
};

/**
 * Process server start command
 */
var processArgs = function(app, args) {
  var serverType = args.serverType || Constants.RESERVED.MASTER;
  var serverId = args.id || app.getMaster().id;
  var mode = args.mode || Constants.RESERVED.CLUSTER;
  var masterha = args.masterha || 'false';
  var type = args.type || Constants.RESERVED.ALL;
  var startId = args.startId;

  //设置当前服务器的server_type server_id
  app.set(Constants.RESERVED.MAIN, args.main, true);
  app.set(Constants.RESERVED.SERVER_TYPE, serverType, true);
  app.set(Constants.RESERVED.SERVER_ID, serverId, true);
  app.set(Constants.RESERVED.MODE, mode, true);
  app.set(Constants.RESERVED.TYPE, type, true);
  if(!!startId) {
    app.set(Constants.RESERVED.STARTID, startId, true);
  }

  if (masterha === 'true') {
    app.master = args;
    app.set(Constants.RESERVED.CURRENT_SERVER, args, true);
  } else if (serverType !== Constants.RESERVED.MASTER) {
    app.set(Constants.RESERVED.CURRENT_SERVER, args, true);
  } else {
    app.set(Constants.RESERVED.CURRENT_SERVER, app.getMaster(), true);
  }
};

/**
 * Setup enviroment.
 */
var setupEnv = function(app, args) {//设置当前的开发环境
  app.set(Constants.RESERVED.ENV, args.env || process.env.NODE_ENV || Constants.RESERVED.ENV_DEV, true);
};

/**
 * Configure custom logger.
 * 配置自定义日志记录管理器
 */
var configLogger = function(app) {
  if (process.env.POMELO_LOGGER !== 'off') {
    var env = app.get(Constants.RESERVED.ENV);
    var originPath = path.join(app.getBase(), Constants.FILEPATH.LOG);
    var presentPath = path.join(app.getBase(), Constants.FILEPATH.CONFIG_DIR, env, path.basename(Constants.FILEPATH.LOG));
    if(fs.existsSync(originPath)) {
      log.configure(app, originPath);
    } else if(fs.existsSync(presentPath)) {
      log.configure(app, presentPath);
    } else {
      logger.error('logger file path configuration is error.');
    }
  }
};

/**
 * Parse command line arguments.
 *
 * @param args command line arguments
 *
 * @return Object argsMap map of arguments
 */
//解析命令行参数==>[{key,value}]
var parseArgs = function(args) {
  var argsMap = {};
  var mainPos = 1;

  while (args[mainPos].indexOf('--') > 0) {
    mainPos++;
  }
  argsMap.main = args[mainPos];

  for (var i = (mainPos + 1); i < args.length; i++) {
    var arg = args[i];
    var sep = arg.indexOf('=');
    var key = arg.slice(0, sep);
    var value = arg.slice(sep + 1);
    if (!isNaN(Number(value)) && (value.indexOf('.') < 0)) {
      value = Number(value);
    }
    argsMap[key] = value;
  }

  return argsMap;
};

/**
 * Load lifecycle file.
 * //根据当前不同的服务器类型，绑定对应服务器类型下的生命文件
 */
var loadLifecycle = function(app) {
  
  var filePath = path.join(app.getBase(), Constants.FILEPATH.SERVER_DIR, app.serverType, Constants.FILEPATH.LIFECYCLE);
  if(!fs.existsSync(filePath)) {
    return;
  }
  var lifecycle = require(filePath);//获取生命周期模块
  for(var key in lifecycle) {
    if(typeof lifecycle[key] === 'function') {
      app.lifecycleCbs[key] = lifecycle[key];//注册生命周期函数  k=>value
    } else {
      logger.warn('lifecycle.js in %s is error format.', filePath);
    }
  }
};
