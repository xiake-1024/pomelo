var exp = module.exports;

/**
 * Count down to zero or timeout and invoke cb finally.
 */
var CountDownLatch = function(count, opts, cb) {
  this.count = count;//统计次数
  this.cb = cb;
  var self = this;
  if (opts.timeout) { //定时器统计，如果超时后外部逻辑统计依然失败，将消息回调返回上层逻辑
    this.timerId = setTimeout(function() {
      self.cb(true);//超时后通知上层
    }, opts.timeout);
  }
};

/**
 * Call when a task finish to count down.
 *
 * @api public
 */
CountDownLatch.prototype.done = function() {//完成一个统计计数器减一
  if(this.count <= 0) {
    throw new Error('illegal state.');
  }

  this.count--;//异步回来后对象上count减一
  if (this.count === 0) {
    if (this.timerId) {
      clearTimeout(this.timerId);
    }
    this.cb();//通知回调count个执行完毕
  }
};

/**
 * Create a count down latch
 *
 * @param {Integer} count
 * @param {Object} opts, opts.timeout indicates timeout, optional param
 * @param {Function} cb, cb(isTimeout)
 *
 * @api public
 */
exp.createCountDownLatch = function(count, opts, cb) {//异步计数统计
  if(!count || count <= 0) {
    throw new Error('count should be positive.');
  }

  if (!cb && typeof opts === 'function') {
    cb = opts;
    opts = {};
  }

  if(typeof cb !== 'function') {
    throw new Error('cb should be a function.');
  }

  return new CountDownLatch(count, opts, cb);
};
