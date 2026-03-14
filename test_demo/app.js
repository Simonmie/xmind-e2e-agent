// Mock Data Utilities
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min
const randomPrice = () => (Math.random() * 500).toFixed(2)
const randomImage = (id) => `https://picsum.photos/seed/${id}/300/300`

const titles = [
  '柯基幼犬专用狗粮 5kg',
  '全自动智能猫砂盆 九成新',
  '狗狗磨牙棒 耐咬型',
  '宠物外出便携包 透气',
  '猫咪爬架 实木 多层',
  '狗狗牵引绳 防爆冲',
  '宠物饮水机 滤芯已换',
  '猫抓板 瓦楞纸 大号',
  '宠物保暖窝 冬季必备',
  '狗狗飞盘 软胶材质',
]

const avatars = ['Felix', 'Buddy', 'Ginger', 'Lucy', 'Max', 'Bella']

function generateProduct(id) {
  const title = titles[randomInt(0, titles.length - 1)]
  const price = randomPrice()
  const image = randomImage(id)
  const avatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${avatars[id % avatars.length]}`
  const seller = `卖家${randomInt(100, 999)}`
  const want = randomInt(0, 50)

  return { id, title, price, image, avatar, seller, want }
}

// State
let page = 1
let loading = false
const productList = document.getElementById('product-list')
const loadingIndicator = document.getElementById('loading')
const searchInput = document.getElementById('search-input')
const searchSuggestions = document.getElementById('search-suggestions')

// Render Product Card
function createProductCard(product) {
  const div = document.createElement('div')
  div.className =
    'bg-white rounded-lg overflow-hidden shadow-sm break-inside-avoid cursor-pointer hover:shadow-md transition-shadow'
  div.innerHTML = `
        <div class="aspect-square bg-stone-200 overflow-hidden relative">
            <img src="${product.image}" alt="${product.title}" class="w-full h-full object-cover" loading="lazy">
        </div>
        <div class="p-2">
            <h3 class="text-sm font-medium line-clamp-2 h-10 leading-tight mb-2">${product.title}</h3>
            <div class="flex items-end justify-between mb-2">
                <div class="text-accent font-bold">
                    <span class="text-xs">¥</span><span class="text-lg">${product.price}</span>
                </div>
                <div class="text-[10px] text-stone-400">${product.want}人想要</div>
            </div>
            <div class="flex items-center gap-1.5">
                <div class="w-4 h-4 rounded-full bg-stone-100 overflow-hidden">
                    <img src="${product.avatar}" class="w-full h-full object-cover">
                </div>
                <span class="text-[10px] text-stone-500 truncate">${product.seller}</span>
            </div>
        </div>
    `

  // Navigate to Detail Page
  div.addEventListener('click', () => {
    const params = new URLSearchParams({
      id: product.id,
      title: product.title,
      price: product.price,
      img: product.image,
    })
    window.location.href = `detail.html?${params.toString()}`
  })

  return div
}

// Load Products
function loadProducts(count = 10) {
  if (loading) return
  loading = true
  loadingIndicator.classList.remove('hidden')

  // Simulate Network Delay
  setTimeout(() => {
    const fragment = document.createDocumentFragment()
    for (let i = 0; i < count; i++) {
      const id = (page - 1) * count + i + 1
      const product = generateProduct(id)
      fragment.appendChild(createProductCard(product))
    }
    productList.appendChild(fragment)

    loading = false
    loadingIndicator.classList.add('hidden')
    page++
  }, 800)
}

// Infinite Scroll
function handleScroll() {
  const { scrollTop, scrollHeight, clientHeight } = document.documentElement
  if (scrollTop + clientHeight >= scrollHeight - 100) {
    loadProducts()
  }
}

// Search Suggestions Logic
if (searchInput && searchSuggestions) {
  searchInput.addEventListener('focus', () => {
    searchSuggestions.classList.remove('hidden')
  })

  // Delay hiding to allow click event on suggestions
  searchInput.addEventListener('blur', () => {
    setTimeout(() => {
      searchSuggestions.classList.add('hidden')
    }, 200)
  })

  // Handle input (mock filtering)
  searchInput.addEventListener('input', () => {
    // In a real app, you would fetch suggestions here
  })

  // Handle suggestion click
  document.querySelectorAll('.suggestion-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      searchInput.value = e.target.innerText
      // Trigger search or something
    })
  })
}

// Initial Load
document.addEventListener('DOMContentLoaded', () => {
  loadProducts(10)
  window.addEventListener('scroll', handleScroll)
})
