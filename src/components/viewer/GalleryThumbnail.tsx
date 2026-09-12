// Adapted from Afilmory/Afilmory, apps/web/src/modules/viewer/GalleryThumbnail.tsx
// Upstream 1f65cde6672e5231599182620116ac904e39f548; AGPL-3.0-or-later + ANL §4, Copyright (c) 2025 Afilmory Team.
// See THIRD_PARTY_NOTICES.md for the local adaptations.
import { HoverCard, HoverCardContent, HoverCardTrigger } from './HoverCard'
import { Thumbhash } from './Thumbhash'
import { clsxm, Spring } from '@afilmory/utils'
import { useVirtualizer } from '@tanstack/react-virtual'
import { m, useReducedMotion } from 'motion/react'
import type { FC } from 'react'
import { useEffect, useRef, useState } from 'react'

import { useMobile } from '../../hooks/useMobile'
const nextFrame = (callback: FrameRequestCallback) => requestAnimationFrame(callback)
import type { ViewerPhoto } from './photos'

const thumbnailSize = {
  mobile: 48,
  desktop: 64,
}

export const GalleryThumbnail: FC<{
  currentIndex: number
  photos: readonly ViewerPhoto[]
  onIndexChange: (index: number) => void
  visible?: boolean
  disableEntryTransition?: boolean
}> = ({ currentIndex, photos, onIndexChange, visible = true, disableEntryTransition = false }) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const isMobile = useMobile()
  const reduced = !!useReducedMotion()

  const [scrollContainerWidth, setScrollContainerWidth] = useState(0)

  const thumbnailHeight = isMobile ? thumbnailSize.mobile : thumbnailSize.desktop

  // Use tanstack virtual for horizontal scrolling
  const virtualizer = useVirtualizer({
    count: photos.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: (index) => {
      const photo = photos[index]
      return photo ? thumbnailHeight * (photo.width / photo.height) : thumbnailHeight
    },
    horizontal: true,
    overscan: 5,
  })

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current
    if (scrollContainer) {
      setScrollContainerWidth(scrollContainer.clientWidth)
      const handleResize = () => {
        setScrollContainerWidth(scrollContainer.clientWidth)
      }
      const observer = new ResizeObserver(handleResize)
      observer.observe(scrollContainer)
      return () => {
        observer.disconnect()
      }
    }
  }, [])

  useEffect(() => {
    let frame = 0
    const scrollContainer = scrollContainerRef.current

    if (scrollContainer && photos.length > 0 && currentIndex < photos.length) {
      // Use virtualizer's actual measurements for accurate positioning
      const virtualItem = virtualizer.getVirtualItems().find(item => item.index === currentIndex)

      if (virtualItem) {
        // virtualItem.start is the actual measured start position
        // virtualItem.size is the actual measured size
        const thumbnailCenter = virtualItem.start + virtualItem.size / 2

        // Center the thumbnail in the viewport
        const scrollLeft = thumbnailCenter - scrollContainerWidth / 2

        frame = nextFrame(() => {
          scrollContainer.scrollTo({
            left: Math.max(0, scrollLeft),
            behavior: reduced ? 'instant' : 'smooth',
          })
        })
      }
      else {
        // Fallback: calculate manually if virtual item not yet rendered
        let thumbnailLeft = 0
        for (let i = 0; i < currentIndex; i++) {
          const photo = photos[i]
          const width = thumbnailHeight * (photo.width / photo.height)
          thumbnailLeft += width
        }

        const currentPhoto = photos[currentIndex]
        const currentThumbnailWidth = thumbnailHeight * (currentPhoto.width / currentPhoto.height)
        const thumbnailCenter = thumbnailLeft + currentThumbnailWidth / 2
        const scrollLeft = thumbnailCenter - scrollContainerWidth / 2

        frame = nextFrame(() => {
          scrollContainer.scrollTo({
            left: Math.max(0, scrollLeft),
            behavior: reduced ? 'instant' : 'smooth',
          })
        })
      }
    }
    return () => cancelAnimationFrame(frame)
  }, [currentIndex, isMobile, scrollContainerWidth, photos, thumbnailHeight, reduced])

  useEffect(() => { virtualizer.measure() }, [thumbnailHeight, photos, virtualizer])

  // 处理鼠标滚轮事件，映射为横向滚动
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) {
      return
    }

    const handleWheel = (e: WheelEvent) => {
      // 阻止默认的垂直滚动
      e.preventDefault()

      // 优先使用触控板的横向滚动 (deltaX)
      // 如果没有横向滚动，则将垂直滚动 (deltaY) 转换为横向滚动
      const scrollAmount = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      scrollContainer.scrollLeft += scrollAmount
    }

    scrollContainer.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      scrollContainer.removeEventListener('wheel', handleWheel)
    }
  }, [])

  return (
    <m.div
      className="viewer-thumbnail-bar"
      initial={disableEntryTransition || reduced ? false : { y: 100, opacity: 0 }}
      animate={{
        y: visible || reduced ? 0 : 48,
        opacity: visible ? 1 : 0,
      }}
      exit={{ y: reduced ? 0 : 100, opacity: 0 }}
      transition={reduced ? { duration: 0 } : Spring.presets.smooth}
      style={{
        pointerEvents: visible ? 'auto' : 'none',
        boxShadow:
          '0 -8px 32px color-mix(in srgb, var(--color-accent) 8%, transparent), 0 -4px 16px color-mix(in srgb, var(--color-accent) 6%, transparent), 0 -2px 8px rgba(0, 0, 0, 0.1)',
      }}
    >
      {/* Inner glow layer */}
      <div
        className="viewer-thumbnail-glow"
        style={{
          background: 'linear-gradient(to top, color-mix(in srgb, var(--color-accent) 5%, transparent), transparent)',
        }}
      />
      <div ref={scrollContainerRef} className="viewer-filmstrip" aria-label="照片缩略图导航">
        <div
          style={{
            height: `${thumbnailHeight}px`,
            width: `${virtualizer.getTotalSize()}px`,
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const photo = photos[virtualItem.index]
            const thumbnailWidth = thumbnailHeight * (photo.width / photo.height)
            const isCurrent = virtualItem.index === currentIndex

            return (
              <div
                key={virtualItem.key}
                data-index={virtualItem.index}
                className="viewer-thumbnail-item"
                style={{
                  height: `${thumbnailHeight}px`,
                  width: `${thumbnailWidth}px`,
                  transform: `translateX(${virtualItem.start}px)`,
                }}
              >
                {!isMobile ? (
                  <HoverCard openDelay={100} closeDelay={0}>
                    <HoverCardTrigger asChild>
                      <button
                        type="button"
                        className={clsxm('viewer-thumbnail-button', isCurrent && 'selected')}
                        data-filmstrip-id={photo.id}
                        tabIndex={isCurrent ? 0 : -1}
                        aria-label={`跳至照片：${photo.title}`}
                        aria-current={isCurrent ? 'true' : undefined}
                        onClick={() => onIndexChange(virtualItem.index)}
                      >
                        {photo.thumbHash && (
                          <Thumbhash thumbHash={photo.thumbHash} className="viewer-thumbnail-image" />
                        )}
                        <img
                          src={photo.thumbnail}
                          alt={photo.title}
                          className="viewer-thumbnail-image"
                        />
                      </button>
                    </HoverCardTrigger>

                    <HoverCardContent
                      side="top"
                      align="center"
                      sideOffset={0}
                      alignOffset={0}
                      className="viewer-thumbnail-hover"
                      container={scrollContainerRef.current?.closest('dialog')}
                    >
                      <div className="viewer-thumbnail-hover-inner">
                        {/* Preview image */}
                        <div
                          className="viewer-thumbnail-hover-image"
                          style={{ aspectRatio: (photo.width / photo.height), height: 'auto' }}
                        >
                          {photo.thumbHash && (
                            <Thumbhash thumbHash={photo.thumbHash} className="viewer-thumbnail-image" />
                          )}
                          <img
                            src={photo.thumbnail}
                            alt={photo.title}
                            className="viewer-thumbnail-image"
                          />
                        </div>
                        {/* Photo info overlay */}
                        {(photo.title || photo.date) && (
                          <div className="viewer-thumbnail-hover-caption">
                            {photo.title && (
                              <div className="viewer-thumbnail-hover-title">{photo.title}</div>
                            )}
                            {photo.date && (
                              <div className="viewer-thumbnail-hover-date">
                                {new Date(photo.date).toLocaleDateString()}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </HoverCardContent>
                  </HoverCard>
                ) : (
                  <button
                    type="button"
                    className={clsxm('viewer-thumbnail-button', isCurrent && 'selected')}
                        data-filmstrip-id={photo.id}
                        tabIndex={isCurrent ? 0 : -1}
                        aria-label={`跳至照片：${photo.title}`}
                        aria-current={isCurrent ? 'true' : undefined}
                    onClick={() => onIndexChange(virtualItem.index)}
                  >
                    {photo.thumbHash && (
                      <Thumbhash thumbHash={photo.thumbHash} className="viewer-thumbnail-image" />
                    )}
                    <img
                      src={photo.thumbnail}
                      alt={photo.title}
                      className="viewer-thumbnail-image"
                    />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </m.div>
  )
}
