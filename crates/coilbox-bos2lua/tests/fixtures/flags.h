/*
** flags.h -- explosion flags and unit value numbers, written for the
** converter's tests in the style of Total Annihilation's own headers.
*/

#ifndef FLAGS_H
#define FLAGS_H

#define SHATTER			1		// flies apart
#define FALL			4		// drops under gravity
#define SMOKE			8		// trails smoke
#define BITMAPONLY		32		// no debris at all
#define BITMAP1			256
#define BITMAP2			512

// Indices for set/get value
#define INBUILDSTANCE		5	// set or get
#define BUILD_PERCENT_LEFT	17	// get
#define PIECE_Y				8	// get

#endif
