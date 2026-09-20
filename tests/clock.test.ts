import test from 'node:test';
import assert from 'node:assert/strict';
import { SystemClockDriver } from '../assets/framework/core/clock-driver';
test('platform clock accepts an explicit normalized counter and resets continuity after background',()=>{
  let microseconds=100000;const clock=new SystemClockDriver(false,()=>microseconds/1000);
  assert.equal(clock.monotonicMs(),100);microseconds+=1500;assert.equal(clock.monotonicMs(),101.5);
  let changes=0;const off=clock.onStateChange(()=>changes++);clock.setBackground(true);clock.setBackground(false);off();
  assert.equal(clock.epoch,1);assert.equal(changes,2);assert.equal(clock.background,false);
});
test('a Date.now performance shim is rejected instead of being treated as monotonic',()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'performance')!;
  try{Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:Date.now}});assert.throws(()=>new SystemClockDriver(),{code:'MONOTONIC_CLOCK_UNAVAILABLE'});}
  finally{Object.defineProperty(globalThis,'performance',descriptor);}
});
