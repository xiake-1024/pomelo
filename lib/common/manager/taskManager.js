var sequeue = require('seq-queue');

var manager = module.exports;

var queues = {};

manager.timeout = 3000;

/**
 * Add tasks into task group. Create the task group if it dose not exist.
 *
 * @param {String}   key       task key
 * @param {Function} fn        task callback
 * @param {Function} ontimeout task timeout callback
 * @param {Number}   timeout   timeout for task
 */
manager.addTask = function(key, fn, ontimeout, timeout) {
  var queue = queues[key];//创建指定key的异步任务队列
  if(!queue) {
    queue = sequeue.createQueue(manager.timeout);
    queues[key] = queue;
  }

  return queue.push(fn, ontimeout, timeout);//任务入队
};

/**
 * Destroy task group
 *
 * @param  {String} key   task key
 * @param  {Boolean} force whether close task group directly
 */
//关闭掉指定的任务队列
manager.closeQueue = function(key, force) {
  if(!queues[key]) {
    // ignore illeagle key
    return;
  }

  queues[key].close(force);
  delete queues[key];
};
