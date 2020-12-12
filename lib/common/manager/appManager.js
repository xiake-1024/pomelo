var async = require('async');
var utils = require('../../util/utils');
var logger = require('pomelo-logger').getLogger('pomelo', __filename);
var transactionLogger = require('pomelo-logger').getLogger('transaction-log', __filename);
var transactionErrorLogger = require('pomelo-logger').getLogger('transaction-error-log', __filename);

var manager = module.exports;

manager.transaction = function(name, conditions, handlers, retry) {
	if(!retry) {//默认尝试次数为1次
    retry = 1;
  }
  if(typeof name !== 'string') { //事务名字必须为字符串
    logger.error('transaction name is error format, name: %s.', name);
    return;
  }
  if(typeof conditions !== 'object' || typeof handlers !== 'object') {
    logger.error('transaction conditions parameter is error format, conditions: %j, handlers: %j.', conditions, handlers);
    return;
  }

  var cmethods=[] ,dmethods=[], cnames=[], dnames=[];
  for(var key in conditions) {//事务执行条件检测
    if(typeof key !== 'string' || typeof conditions[key] !== 'function') {
      logger.error('transaction conditions parameter is error format, condition name: %s, condition function: %j.', key, conditions[key]);
      return;
    }
    cnames.push(key);
    cmethods.push(conditions[key]);
  }//将条件执行函数 [{name,method}]

  var i = 0;
  // execute conditions
  async.forEachSeries(cmethods, function(method, cb) {
    method(cb);//执行方法
    transactionLogger.info('[%s]:[%s] condition is executed.', name, cnames[i]);
    i++;
  }, function(err) {//执行回调
    if(err) {
      process.nextTick(function() {//事务执行失败回调
        transactionLogger.error('[%s]:[%s] condition is executed with err: %j.', name, cnames[--i], err.stack);
        var log = {
          name: name,
          method: cnames[i],
          time: Date.now(),
          type: 'condition',
          description: err.stack
        };
        transactionErrorLogger.error(JSON.stringify(log));
      });
      return;
    } else {
      // execute handlers
      process.nextTick(function() {
        for(var key in handlers) {
          if(typeof key !== 'string' || typeof handlers[key] !== 'function') {
            logger.error('transcation handlers parameter is error format, handler name: %s, handler function: %j.', key, handlers[key]);
            return;
          }
          dnames.push(key);
          dmethods.push(handlers[key]);
        }

        var flag = true;
        var times = retry;
        
        // do retry if failed util retry times
        //执行方法
        async.whilst(
          function() {//循环执行函数的终止条件
            return retry > 0 && flag;
          },
          function(callback) {
            var j = 0;
            retry--;
            async.forEachSeries(dmethods, function(method, cb) {
              method(cb);
              transactionLogger.info('[%s]:[%s] handler is executed.', name, dnames[j]);
              j++;
            }, function(err) {
              if(err) {//有一个失败全部失败，然后再次尝试执行事务。
                process.nextTick(function() {
                  transactionLogger.error('[%s]:[%s]:[%s] handler is executed with err: %j.', name, dnames[--j], times-retry, err.stack);
                  var log = {
                    name: name,
                    method: dnames[j],
                    retry: times-retry,
                    time: Date.now(),
                    type: 'handler',
                    description: err.stack
                  };
                  transactionErrorLogger.error(JSON.stringify(log));
                  utils.invokeCallback(callback);
                });
                return;
              }
              //全部事务执行成功，循环终止
              flag = false;
              utils.invokeCallback(callback);//循环执行完毕后，调用
              process.nextTick(function() {
                transactionLogger.info('[%s] all conditions and handlers are executed successfully.', name);
              });
            });
          },
          function(err) {//callback(第二步的回调函数中的参数,标志着while的结束后的函数调用，不结束会一直调用第二步)
            if(err) {
              logger.error('transaction process is executed with error: %j', err);
            }
            // callback will not pass error
          }
        );
      });
    }
  });
};