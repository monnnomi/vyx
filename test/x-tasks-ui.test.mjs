import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/x-tasks.js',import.meta.url),'utf8');
function setup(connected=false){
 const state={connected,total:1500,earned:0,availability:{state:'ready',retryAt:null},tasks:[{id:'pending-like',kind:'like',title:'Like the VYX update',amount:1500,status:'not-verified',canCheck:connected,detail:'Reconnect X',url:'https://x.com/vyxsocial/status/2121127790556680479'}]};
 const ctx=vm.createContext({data:{user:{id:'alice'}},page:'tasks',document:{hidden:false,addEventListener(){}},window:{addEventListener(){}},setInterval(){},setTimeout(){},clearTimeout(){},Date,URL,e:String,fmt:String,render(){},calls:[]});
 vm.runInContext(source,ctx);ctx.state=state;vm.runInContext("xTaskOwner='alice';xTaskData=state;",ctx);return {ctx,state};
}
test('expired grants offer an actionable reconnect link instead of a disabled check',()=>{
 const {ctx}=setup();const html=ctx.renderTasks();assert.match(html,/Connect X & check tasks/);assert.match(html,/Connect X to check/);assert.match(html,/returnTo=%2Ftasks/);assert.doesNotMatch(html,/data-x-task-check="pending-like"/);assert.doesNotMatch(html,/daily verification limit has been reached/);
});
test('connected grants retain normal checks and server budget pauses still disable them',()=>{
 const {ctx,state}=setup(true);assert.match(ctx.renderTasks(),/data-x-task-check="pending-like"/);assert.doesNotMatch(ctx.renderTasks(),/Connect X to check/);
 state.tasks[0].canCheck=false;state.availability={state:'paused',retryAt:'2026-11-18T00:00:00Z'};const html=ctx.renderTasks();assert.match(html,/data-x-task-check="pending-like" disabled/);assert.match(html,/daily verification limit has been reached/);
});
test('returning from X after access expires prompts reconnection and makes no paid verification request',()=>{
 const {ctx}=setup();ctx.checkXTasks=()=>ctx.calls.push('paid');vm.runInContext("xTaskPending={taskId:'pending-like',owner:'alice',at:Date.now()-10000};checkReturnedXTask();",ctx);assert.deepEqual(ctx.calls,[]);assert.match(vm.runInContext('xTaskError',ctx),/Reconnect X/);
});
