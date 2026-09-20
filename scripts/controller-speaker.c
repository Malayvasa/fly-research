// macOS USB DualSense speaker probe. No default audio-device changes.
// Report layout reference: https://github.com/nowrep/dualsensectl (main.c).
#include <AudioToolbox/AudioToolbox.h>
#include <CoreAudio/CoreAudio.h>
#include <IOKit/hid/IOHIDManager.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <stdatomic.h>
#include <signal.h>
#include <sys/select.h>
static volatile sig_atomic_t stopping=0;
static void stopSignal(int sig) { stopping=1; }
typedef struct {
  _Atomic long start;
  _Atomic int frames;
  _Atomic int hz;
  long rendered;
} Tone;
static void callback(void *ctx, AudioQueueRef queue, AudioQueueBufferRef buffer) {
  Tone *tone = ctx;
  float *samples = buffer->mAudioData;
  memset(samples,0,240*16);
  long start = atomic_load(&tone->start);
  int frames = atomic_load(&tone->frames), hz = atomic_load(&tone->hz);
  for (int i=0;i<240;i++) {
    long offset = tone->rendered+i-start;
    if (offset>=0 && offset<frames) {
      double t=(double)offset/48000, remaining=(double)(frames-offset)/48000;
      double envelope=fmin(1,t/.01)*fmin(1,remaining/.03);
      samples[i*4+1]=.7*envelope*sin(2*M_PI*hz*t);
    }
  }
  tone->rendered += 240;
  buffer->mAudioDataByteSize=240*16;
  AudioQueueEnqueueBuffer(queue,buffer,0,NULL);
}
static OSStatus light(IOHIDDeviceRef device, int red, int green) {
  uint8_t report[63]={0};
  report[0]=2; report[2]=4;
  report[45]=red; report[46]=green;
  return IOHIDDeviceSetReport(device,kIOHIDReportTypeOutput,2,report,sizeof(report));
}
static void check(OSStatus status, const char *step) {
  if (status) { fprintf(stderr, "%s failed: %d\n", step, (int)status); exit(1); }
}
int main(int argc, char **argv) {
  AudioObjectPropertyAddress prop = {kAudioHardwarePropertyDevices, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain};
  UInt32 size = 0;
  check(AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &prop, 0, NULL, &size), "enumerate audio");
  AudioDeviceID *devices = malloc(size);
  check(AudioObjectGetPropertyData(kAudioObjectSystemObject, &prop, 0, NULL, &size, devices), "read audio devices");
  CFStringRef uid = NULL;
  for (unsigned i = 0; i < size / sizeof(*devices); i++) {
    AudioObjectPropertyAddress nameProp = {kAudioObjectPropertyName, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain};
    CFStringRef name = NULL; UInt32 n = sizeof(name);
    if (AudioObjectGetPropertyData(devices[i], &nameProp, 0, NULL, &n, &name)) continue;
    int match = CFStringFind(name, CFSTR("DualSense"), 0).location != kCFNotFound;
    CFRelease(name);
    if (!match) continue;
    AudioObjectPropertyAddress streams = {kAudioDevicePropertyStreams, kAudioObjectPropertyScopeOutput, kAudioObjectPropertyElementMain};
    UInt32 streamSize = 0;
    if (AudioObjectGetPropertyDataSize(devices[i], &streams, 0, NULL, &streamSize) || !streamSize) continue;
    nameProp.mSelector = kAudioDevicePropertyDeviceUID; n = sizeof(uid);
    check(AudioObjectGetPropertyData(devices[i], &nameProp, 0, NULL, &n, &uid), "get controller output UID");
    break;
  }
  free(devices);
  if (!uid) { fprintf(stderr, "No DualSense USB audio output found\n"); return 1; }
  IOHIDManagerRef manager = IOHIDManagerCreate(kCFAllocatorDefault, kIOHIDOptionsTypeNone);
  int vendor = 0x054c, product = 0x0ce6;
  CFNumberRef v = CFNumberCreate(NULL,kCFNumberIntType,&vendor), p = CFNumberCreate(NULL,kCFNumberIntType,&product);
  const void *keys[] = {CFSTR(kIOHIDVendorIDKey),CFSTR(kIOHIDProductIDKey),CFSTR(kIOHIDTransportKey)};
  const void *values[] = {v,p,CFSTR("USB")};
  CFDictionaryRef filter = CFDictionaryCreate(NULL,keys,values,3,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks);
  IOHIDManagerSetDeviceMatching(manager,filter);
  check(IOHIDManagerOpen(manager,kIOHIDOptionsTypeNone), "open HID manager");
  CFSetRef set = IOHIDManagerCopyDevices(manager);
  if (!set || !CFSetGetCount(set)) { fprintf(stderr,"No USB DualSense HID found\n"); return 1; }
  IOHIDDeviceRef device;
  // There is normally one matching USB gamepad; enumerate without seizing it.
  const void **matches = calloc(CFSetGetCount(set),sizeof(void*)); CFSetGetValues(set,matches); device = (IOHIDDeviceRef)matches[0]; free(matches);
  check(IOHIDDeviceOpen(device,kIOHIDOptionsTypeNone), "open controller");
  uint8_t report[63] = {0};
  report[0] = 0x02; report[1] = 0xa0; // speaker volume + audio routing only
  report[2] = 0x04; // enable lightbar color update
  report[39] = 0x02; report[42] = 0x01; // take lightbar out of its startup animation
  report[45] = 0;
  report[46] = 0;
  report[47] = 0;
  report[6] = 100; report[8] = 0x30; // full hardware volume, right channel -> internal speaker
  check(IOHIDDeviceSetReport(device,kIOHIDReportTypeOutput,2,report,sizeof(report)), "enable speaker");
  AudioStreamBasicDescription format = {0};
  format.mSampleRate = 48000; format.mFormatID = kAudioFormatLinearPCM;
  format.mFormatFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked;
  format.mBytesPerPacket = format.mBytesPerFrame = 4 * sizeof(float);
  format.mFramesPerPacket = 1; format.mChannelsPerFrame = 4; format.mBitsPerChannel = 32;
  Tone tone = {.start=-48000,.frames=0,.hz=440,.rendered=0};
  AudioQueueRef queue;
  check(AudioQueueNewOutput(&format,callback,&tone,NULL,NULL,0,&queue), "create audio queue");
  check(AudioQueueSetProperty(queue,kAudioQueueProperty_CurrentDevice,&uid,sizeof(uid)), "select controller output");
  // Keep a 15 ms queue of silence flowing; no per-beep device/process startup.
  for (int i=0;i<3;i++) {
    AudioQueueBufferRef buffer;
    check(AudioQueueAllocateBuffer(queue,240*16,&buffer), "allocate audio");
    callback(&tone,queue,buffer);
  }
  check(AudioQueueStart(queue,NULL), "start persistent audio");
  setbuf(stdout,NULL);
  puts("READY");
  long lightOn=-1, lightOff=-1;
  int go=0;
  signal(SIGTERM,stopSignal); signal(SIGINT,stopSignal);
  while (!stopping) {
    fd_set readSet; FD_ZERO(&readSet); FD_SET(STDIN_FILENO,&readSet);
    struct timeval timeout={0,2000};
    if (select(STDIN_FILENO+1,&readSet,NULL,NULL,&timeout)>0) {
      char line[32];
      if (!fgets(line,sizeof(line),stdin)) break;
      int step=-1;
      if (sscanf(line,"%d",&step)!=1 || step<0 || step>5) continue;
      AudioTimeStamp clock={0};
      check(AudioQueueGetCurrentTime(queue,NULL,&clock,NULL),"read audio clock");
      go=step==0;
      int frames=go?19200:7680;
      lightOn=(long)clock.mSampleTime+1440; // 30 ms scheduling lead
      lightOff=lightOn+frames;
      atomic_store(&tone.frames,frames);
      atomic_store(&tone.hz,go?880:440);
      atomic_store(&tone.start,lightOn);
    }
    AudioTimeStamp clock={0};
    if (!AudioQueueGetCurrentTime(queue,NULL,&clock,NULL)) {
      if (lightOn>=0 && clock.mSampleTime>=lightOn) {
        OSStatus result=light(device,go?0:255,go?255:0);
        printf("%s\n",result?"ERROR":"PLAYING");
        lightOn=-1;
      }
      if (lightOff>=0 && clock.mSampleTime>=lightOff) {
        light(device,0,0); lightOff=-1;
      }
    }
  }
  light(device,0,0);
  AudioQueueStop(queue,true); AudioQueueDispose(queue,true);
  IOHIDDeviceClose(device,0); IOHIDManagerClose(manager,0);
  CFRelease(set); CFRelease(filter); CFRelease(v); CFRelease(p); CFRelease(manager); CFRelease(uid);

  return 0;
}
