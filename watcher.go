package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

type filesystemWatcher struct {
	watcher     *fsnotify.Watcher
	mu          sync.Mutex
	subscribers map[chan string]struct{}
}

func newFilesystemWatcher(root string) (*filesystemWatcher, error) {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	fw := &filesystemWatcher{watcher: w, subscribers: make(map[chan string]struct{})}
	if err := fw.addDirectoryTree(root); err != nil {
		w.Close()
		return nil, err
	}
	go fw.run()
	return fw, nil
}

func (fw *filesystemWatcher) addDirectoryTree(root string) error {
	return filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			log.Printf("Watcher scan error for %s: %v", path, err)
			return nil
		}
		if !info.IsDir() {
			return nil
		}
		if path != root && !showHidden && strings.HasPrefix(info.Name(), ".") {
			return filepath.SkipDir
		}
		if path != root && ignoreDirMap[info.Name()] {
			return filepath.SkipDir
		}
		if err := fw.watcher.Add(path); err != nil {
			log.Printf("Watcher add error for %s: %v", path, err)
		}
		return nil
	})
}

func (fw *filesystemWatcher) addDirectory(path string) {
	info, err := os.Stat(path)
	if err != nil || !info.IsDir() {
		return
	}
	if !showHidden && strings.HasPrefix(info.Name(), ".") {
		return
	}
	if ignoreDirMap[info.Name()] {
		return
	}
	if err := fw.addDirectoryTree(path); err != nil {
		log.Printf("Watcher recursive add error for %s: %v", path, err)
	}
}

func (fw *filesystemWatcher) run() {
	defer fw.watcher.Close()

	var timer *time.Timer
	var timerC <-chan time.Time

	emitRefresh := func() {
		fw.mu.Lock()
		defer fw.mu.Unlock()
		for subscriber := range fw.subscribers {
			select {
			case subscriber <- "refresh":
			default:
			}
		}
	}

	scheduleRefresh := func() {
		if timer == nil {
			timer = time.NewTimer(180 * time.Millisecond)
		} else {
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			timer.Reset(180 * time.Millisecond)
		}
		timerC = timer.C
	}

	for {
		select {
		case event, ok := <-fw.watcher.Events:
			if !ok {
				return
			}
			if event.Op&fsnotify.Create != 0 {
				if info, err := os.Stat(event.Name); err == nil && info.IsDir() {
					fw.addDirectory(event.Name)
				}
			}
			if event.Op&(fsnotify.Create|fsnotify.Write|fsnotify.Remove|fsnotify.Rename|fsnotify.Chmod) != 0 {
				scheduleRefresh()
			}
		case err, ok := <-fw.watcher.Errors:
			if !ok {
				return
			}
			log.Printf("Filesystem watcher error: %v", err)
		case <-timerC:
			emitRefresh()
			timerC = nil
		}
	}
}

func (fw *filesystemWatcher) subscribe() (chan string, func()) {
	ch := make(chan string, 1)
	fw.mu.Lock()
	fw.subscribers[ch] = struct{}{}
	fw.mu.Unlock()

	return ch, func() {
		fw.mu.Lock()
		if _, exists := fw.subscribers[ch]; exists {
			delete(fw.subscribers, ch)
			close(ch)
		}
		fw.mu.Unlock()
	}
}

func (fw *filesystemWatcher) serveSSE(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	ch, unsubscribe := fw.subscribe()
	defer unsubscribe()

	fmt.Fprint(w, "event: ready\ndata: watcher-online\n\n")
	flusher.Flush()

	for {
		select {
		case <-r.Context().Done():
			return
		case message, ok := <-ch:
			if !ok {
				return
			}
			fmt.Fprintf(w, "event: filesystem\ndata: %s\n\n", message)
			flusher.Flush()
		}
	}
}
