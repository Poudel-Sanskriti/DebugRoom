"""Single-file C++20 source observations via Clang and LLDB, without expressions.

Entry point is main(); input.stdin is provided to the program. Debugger summaries,
synthetic providers, dynamic evaluation, and user .lldbinit scripts are not used.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

sys.path.insert(0, '/usr/lib/llvm-18/lib/python3.12/site-packages')
sys.path.insert(0, '/runner/python')
import lldb
from values import fingerprint

SOURCE = '/work/main.cpp'
BINARY = '/work/program'
START = time.monotonic()
POLICY = {'steps':10000,'outputBytes':262144,'traceBytes':16777216,'eventBytes':262144}
COUNT = 0
TRACE_BYTES = 0
OUTPUT_BYTES = 0
OBJECTS = {}
PROCESS = None
FINISHED = False


def emit(record):
    data=(json.dumps(record,ensure_ascii=True,separators=(',',':'))+'\n').encode()
    offset=0
    while offset<len(data):
        offset+=os.write(1,data[offset:])


def finish(outcome,error=None,returned=None):
    global FINISHED
    if FINISHED:
        return
    FINISHED=True
    if PROCESS is not None and PROCESS.IsValid() and PROCESS.GetState() not in (lldb.eStateExited,lldb.eStateDetached):
        PROCESS.Kill()
    record={'type':'result','outcome':outcome,'durationMs':max(0,(time.monotonic()-START)*1000),'complete':outcome=='completed','objects':OBJECTS}
    if error is not None:
        record['error']=error
    if returned is not None:
        record['returnValue']=returned
    emit(record)


def output(stream,text):
    global OUTPUT_BYTES
    encoded=text.encode('utf-8','replace')
    remaining=POLICY['outputBytes']-OUTPUT_BYTES
    if remaining and encoded:
        emit({'type':'output','stream':stream,'text':encoded[:remaining].decode('utf-8','ignore')})
    OUTPUT_BYTES+=min(len(encoded),remaining)
    if len(encoded)>remaining:
        finish('output_limit')
        return False
    return True


def unavailable(type_,reason):
    return {'kind':'unavailable','type':type_[:100],'reason':reason[:300]}


def scalar(type_,text):
    return {'kind':'scalar','type':type_[:100],'value':str(text)[:4096]}


class Values:
    def __init__(self,target,process):
        self.target=target
        self.process=process
        self.objects={}
        self.serial=0

    def value(self,value,depth=0,force_id=None):
        value.SetPreferSyntheticValue(False)
        value.SetPreferDynamicValue(lldb.eNoDynamicValues)
        type_=value.GetType().GetCanonicalType()
        name=type_.GetName() or 'unknown'
        if not value.IsValid() or value.GetError().Fail():
            return unavailable(name,'The debugger cannot read this value')
        if depth>=8:
            return unavailable(name,'Maximum nesting depth reached')
        if type_.IsPointerType() or type_.IsReferenceType():
            address=value.GetValueAsUnsigned()
            if address==0:
                return scalar('nullptr','nullptr')
            pointee=type_.GetPointeeType() if type_.IsPointerType() else type_.GetDereferencedType()
            size=pointee.GetByteSize()
            if size<=0 or size>65536:
                return unavailable(name,'Pointer target has an unsupported size')
            error=lldb.SBError()
            self.process.ReadMemory(address,min(size,16),error)
            if error.Fail():
                return unavailable(name,'Pointer target is unreadable')
            object_id=f'o{address:x}'
            if object_id in self.objects:
                return {'kind':'ref','id':object_id}
            pointed=value.Dereference()
            if pointed.GetType().GetTypeClass() in (lldb.eTypeClassBuiltin,lldb.eTypeClassEnumeration):
                self.objects[object_id]={'id':object_id,'type':name[:100],'items':[self.value(pointed,depth+1)],'truncated':False}
                return {'kind':'ref','id':object_id}
            return self.value(pointed,depth+1,object_id)
        category=type_.GetTypeClass()
        if category in (lldb.eTypeClassBuiltin,lldb.eTypeClassEnumeration) or (value.GetNumChildren()==0 and value.GetValue() is not None):
            observed=value.GetValue()
            return scalar(name,observed) if observed is not None else unavailable(name,'No scalar value is available')
        address=value.GetLoadAddress()
        self.serial+=1
        object_id=force_id or (f'o{address:x}' if address not in (0,lldb.LLDB_INVALID_ADDRESS) else f'v{self.serial}')
        if object_id in self.objects:
            return {'kind':'ref','id':object_id}
        if len(self.objects)>=256:
            return unavailable(name,'Snapshot object budget reached')
        node={'id':object_id,'type':name[:100],'truncated':False}
        self.objects[object_id]=node
        if 'vector<' in name:
            vector=self.vector(value,type_,depth)
            if vector is not None:
                node.update(vector)
                return {'kind':'ref','id':object_id}
        length=value.GetNumChildren()
        node['truncated']=length>128
        if type_.IsArrayType():
            node['type']='array'
            node['length']=length
            node['items']=[self.value(value.GetChildAtIndex(i,lldb.eNoDynamicValues,False),depth+1) for i in range(min(length,128))]
        else:
            node['attributes']={}
            for i in range(min(length,128)):
                child=value.GetChildAtIndex(i,lldb.eNoDynamicValues,False)
                node['attributes'][(child.GetName() or str(i))[:200]]=self.value(child,depth+1)
        return {'kind':'ref','id':object_id}

    def vector(self,value,type_,depth):
        impl=value.GetChildMemberWithName('_M_impl')
        begin=impl.GetChildMemberWithName('_M_start') if impl.IsValid() else value.GetChildMemberWithName('__begin_')
        end=impl.GetChildMemberWithName('_M_finish') if impl.IsValid() else value.GetChildMemberWithName('__end_')
        if not begin.IsValid() or not end.IsValid():
            return None
        element=type_.GetTemplateArgumentType(0)
        size=element.GetByteSize()
        first,last=begin.GetValueAsUnsigned(),end.GetValueAsUnsigned()
        if size<=0 or last<first or (last-first)%size or (last-first)//size>10_000_000:
            return None
        count=(last-first)//size
        items=[]
        for i in range(min(count,128)):
            child=self.target.CreateValueFromAddress(str(i),lldb.SBAddress(first+i*size,self.target),element)
            items.append(self.value(child,depth+1))
        return {'type':'vector','length':count,'items':items,'truncated':count>128}


def main():
    global COUNT,TRACE_BYTES,OBJECTS,PROCESS,START
    job=json.loads(Path('/tmp/debugroom-job.json').read_text())
    for key in POLICY:
        POLICY[key]=max(1,min(POLICY[key],job.get('limits',{}).get(key,POLICY[key])))
    if job.get('input',{}).get('args') or job.get('input',{}).get('kwargs'):
        finish('input_error',{'type':'InputError','message':'C++ programs start at main(). Provide program input in the stdin field; args and kwargs must be empty.','line':None})
        return
    Path(SOURCE).write_text(job['code'])
    Path('/tmp/program.stdin').write_text(job.get('input',{}).get('stdin',''))
    emit({'type':'phase','phase':'compiling'})
    try:
        compile_result=subprocess.run(['clang++-18','-std=c++20','-O0','-g','-fno-omit-frame-pointer','-fno-inline','-fno-limit-debug-info','-Wall','-Wextra',SOURCE,'-o',BINARY],capture_output=True,text=True,timeout=20)
    except subprocess.TimeoutExpired:
        finish('compile_timeout',{'type':'CompileTimeout','message':'Compilation exceeded its 20-second limit.','line':None})
        return
    if compile_result.stderr and not output('stderr',compile_result.stderr):
        return
    if compile_result.returncode:
        match=re.search(r'main\.cpp:(\d+):\d+: (?:fatal )?error:',compile_result.stderr)
        finish('compile_error',{'type':'CompilerError','message':compile_result.stderr[:16384],'line':int(match.group(1)) if match else None})
        return
    lldb.SBDebugger.Initialize()
    debugger=lldb.SBDebugger.Create(False)
    debugger.SetAsync(False)
    target=debugger.CreateTarget(BINARY)
    if not target.IsValid():
        finish('infrastructure_error',{'type':'DebuggerError','message':'LLDB could not load the compiled program.','line':None})
        return
    executable=target.GetModuleAtIndex(0)
    lines=set()
    for ci in range(executable.GetNumCompileUnits()):
        unit=executable.GetCompileUnitAtIndex(ci)
        for li in range(unit.GetNumLineEntries()):
            entry=unit.GetLineEntryAtIndex(li)
            if entry.GetFileSpec().GetFilename()=='main.cpp' and 0<entry.GetLine()<=len(job['code'].splitlines()):
                lines.add(entry.GetLine())
    for line in sorted(lines):
        target.BreakpointCreateByLocation(SOURCE,line)
    if not lines:
        finish('input_error',{'type':'UnsupportedProgram','message':'No executable source lines were found. Provide a standalone C++ program with main().','line':None})
        return
    launch=lldb.SBLaunchInfo([])
    launch.SetWorkingDirectory('/work')
    launch.SetEnvironmentEntries(['PATH=/usr/bin:/bin','LANG=C.UTF-8'],True)
    launch.SetLaunchFlags(0)  # Do not require personality(ADDR_NO_RANDOMIZE).
    launch.AddOpenFileAction(0,'/tmp/program.stdin',True,False)
    launch.AddOpenFileAction(1,'/tmp/program.stdout',False,True)
    launch.AddOpenFileAction(2,'/tmp/program.stderr',False,True)
    error=lldb.SBError()
    START=time.monotonic()
    emit({'type':'started'})
    PROCESS=target.Launch(launch,error)
    if error.Fail():
        finish('infrastructure_error',{'type':'DebuggerError','message':str(error)[:16384],'line':None})
        return
    identity_counter=0
    active_ids={}
    previous={}
    offsets={'stdout':0,'stderr':0}
    def drain():
        for stream in offsets:
            filename=Path('/tmp/program.'+stream)
            if not filename.exists():
                continue
            with filename.open('rb') as file:
                file.seek(offsets[stream])
                data=file.read(POLICY['outputBytes']+1)
            offsets[stream]+=len(data)
            if data and not output(stream,data.decode('utf-8','replace')):
                return False
        return True
    while PROCESS.IsValid() and not FINISHED:
        if not drain():
            break
        state=PROCESS.GetState()
        if state==lldb.eStateExited:
            exit_code=PROCESS.GetExitStatus()
            finish('completed' if exit_code==0 else 'runtime_error',None if exit_code==0 else {'type':'ExitStatus','message':f'Program exited with status {exit_code}.','line':None},scalar('int',exit_code))
            break
        if state!=lldb.eStateStopped:
            finish('infrastructure_error',{'type':'DebuggerError','message':'The debugger entered an unsupported process state.','line':None})
            break
        thread=PROCESS.GetSelectedThread()
        if not thread.IsValid():
            thread=PROCESS.GetThreadAtIndex(0)
        raw_frames=[]
        for i in range(thread.GetNumFrames()):
            frame=thread.GetFrameAtIndex(i)
            if frame.GetLineEntry().GetFileSpec().GetFilename()=='main.cpp':
                raw_frames.append(frame)
        if thread.GetStopReason() not in (lldb.eStopReasonBreakpoint,lldb.eStopReasonPlanComplete):
            finish('runtime_error',{'type':'Signal','message':thread.GetStopDescription(1000) or 'Program stopped unexpectedly.','line':raw_frames[0].GetLineEntry().GetLine() if raw_frames else None})
            break
        if len(raw_frames)>128:
            finish('trace_size_limit')
            break
        if COUNT>=POLICY['steps']:
            finish('trace_limit')
            break
        if raw_frames:
            values=Values(target,PROCESS)
            frames=[]
            next_ids={}
            for frame in reversed(raw_frames):
                name=(frame.GetFunctionName() or 'main').split('(')[0][:200]
                key=(frame.GetCFA(),name)
                if key not in active_ids:
                    identity_counter+=1
                    active_ids[key]=f'f{identity_counter}'
                frame_id=active_ids[key]
                next_ids[key]=frame_id
                current_line=max(1,frame.GetLineEntry().GetLine())
                locals_={}
                variables=frame.GetVariables(True,True,False,True,lldb.eNoDynamicValues)
                for i in range(min(variables.GetSize(),256)):
                    variable=variables.GetValueAtIndex(i)
                    variable_name=(variable.GetName() or str(i))[:200]
                    declaration_line=variable.GetDeclaration().GetLine()
                    declaration_source=job['code'].splitlines()[declaration_line-1] if 0<declaration_line<=len(job['code'].splitlines()) else ''
                    explicit_initializer=bool(re.search(r'\b'+re.escape(variable_name)+r'\s*(?:\[[^\]]*\]\s*)?(?:=|\{|\()',declaration_source))
                    if variable.GetValueType()!=lldb.eValueTypeVariableArgument and not explicit_initializer:
                        locals_[variable_name]=unavailable(variable.GetTypeName() or 'unknown','Initialization cannot be established for a declaration without an explicit initializer')
                    elif variable.GetValueType()!=lldb.eValueTypeVariableArgument and declaration_line>=current_line:
                        locals_[variable_name]=unavailable(variable.GetTypeName() or 'unknown','Declaration has not executed at this source stop')
                    else:
                        locals_[variable_name]=values.value(variable)
                frames.append({'id':frame_id,'function':name,'line':current_line,'locals':locals_,'changes':{},'truncated':variables.GetSize()>256})
            active_ids=next_ids
            OBJECTS=values.objects
            for frame in frames:
                prior=previous.get(frame['id'],{})
                current={}
                for name,value in frame['locals'].items():
                    signature=fingerprint(value,OBJECTS)
                    current[name]=(value,signature)
                    if name not in prior or prior[name][1]!=signature:
                        frame['changes'][name]={'before':prior[name][0] if name in prior else None,'after':value}
                for name in prior.keys()-current.keys():
                    frame['changes'][name]={'before':prior[name][0],'after':None}
                previous[frame['id']]=current
            event={'index':COUNT,'kind':'line','line':frames[-1]['line'],'frameId':frames[-1]['id'],'frames':frames,'objects':OBJECTS}
            size=len(json.dumps(event).encode())
            if size>POLICY['eventBytes'] or TRACE_BYTES+size>POLICY['traceBytes']:
                finish('trace_size_limit')
                break
            emit({'type':'event','event':event})
            COUNT+=1
            TRACE_BYTES+=size
        PROCESS.Continue()
    if PROCESS.IsValid() and PROCESS.GetState()!=lldb.eStateExited:
        PROCESS.Kill()
    lldb.SBDebugger.Destroy(debugger)


try:
    main()
except BaseException as exc:
    finish('infrastructure_error',{'type':type(exc).__name__,'message':str(exc)[:16384],'line':None})
