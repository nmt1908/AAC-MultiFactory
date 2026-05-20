from PIL import Image, ImageChops

img = Image.open("mapNetCang.png")
bg = Image.new(img.mode, img.size, img.getpixel((0,0)))
diff = ImageChops.difference(img, bg)
bbox = diff.getbbox()

if bbox:
    cropped = img.crop(bbox)
    cropped.save("mapNetCang_cropped.png")
