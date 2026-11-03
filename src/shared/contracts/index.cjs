const data=require('./index.json');
module.exports=Object.freeze({
  methods:Object.freeze(data.methods),
  configKeys:Object.freeze(data.configKeys),
  status:Object.freeze(data.status),
  degraded:Object.freeze(data.degraded || []),
});
