$(document).ready(function() {
    // --- STATE & CONFIG ---
    // URL langsung ke data toko di Firebase Realtime Database dalam format JSON
    const API_URL = 'https://grivieproject-default-rtdb.asia-southeast1.firebasedatabase.app/toko_data.json'; 
    const IMAGE_BASE_URL = 'https://www.jagel.id/api/listimage/';
    const ITEMS_PER_PAGE = 10;

    let USER_LOCATION = null;

    let rawDbData = []; // This will now hold data fetched from Firebase via direct HTTP
    let isDataFetched = false;
    let allStoresData = [],
        allProductsEnriched = [];
    let displayedProductCount = 0,
        displayedStoreCount = 0;
    let sortedProducts = [],
        sortedStores = [];
    let searchResults = [];
    let viewHistory = ['main-feed-view'];
    let searchDebounce;
    let activeViewType = 'produk';
    let activeSort = 'terdekat';
    let activeSearchSort = 'terdekat';
    let activeProductCategory = 'Semua';

    const smartCategories = {
        'Semua': {
            icon: 'grid'
        },
        'Minuman': {
            icon: 'coffee',
            keywords: ['es', 'kopi', 'teh', 'jus', 'milk', 'choco', 'boba', 'drink']
        },
        'Nasi': {
            icon: 'archive',
            keywords: ['nasi', 'ricebowl', 'geprek']
        },
        'Mie': {
            icon: 'hash',
            keywords: ['mie', 'bakmi', 'kwetiau', 'pangsit']
        },
        'Snack': {
            icon: 'gift',
            keywords: ['snack', 'gorengan', 'kue', 'kudapan', 'dimsum', 'pentol', 'cireng', 'sosis', 'kentang', 'burger', 'kebab']
        },
        'Ayam': {
            icon: 'box',
            keywords: ['ayam', 'chicken', 'bebek']
        },
        'Pedas': {
            icon: 'zap',
            keywords: ['pedas', 'sambal', 'spicy', 'mercon']
        },
        'Seafood': {
            icon: 'anchor',
            keywords: ['ikan', 'cumi', 'udang', 'salmon', 'seafood', 'crab']
        }
    };
    const searchSuggestionsData = ["Soto", "Bakso", "Mie Ayam", "Nasi Goreng", "Geprek", "Kopi Susu", "Boba", "Seblak"];

    // --- DOM ELEMENTS ---
    const mainContainer = $('.g-container');
    const loadMoreContainer = $('.g-load-more-container');
    const loadMoreBtn = $('#load-more-btn');
    const categoryScrollerWrapper = $('#category-scroller-wrapper');
    const productFeedContainer = $('#product-feed-container');
    const storeListContainer = $('#store-list-container');
    const searchInput = $('#search-input');
    const searchResultsList = $('#search-results-list');
    const searchSuggestionsContainer = $('#search-suggestions');
    const locationText = $('#current-location-text');
    const editLocationBtn = $('#edit-location-btn');
    const locationModal = $('#location-modal');
    const closeLocationModalBtn = $('.g-modal-close-btn');
    const saveLocationBtn = $('#save-location-btn');
    const locationInputAddress = $('#location-input-address');

    // --- FUNGSI UTAMA APLIKASI ---
    const app = {
        fetchData: async () => {
            if (isDataFetched && rawDbData.length > 0) { // Only re-process if data is already there
                app.processData();
                app.renderInitialHomePage();
                return;
            }
            try {
                productFeedContainer.html(`<p class="g-loading-text">Memuat data toko dari Firebase...</p>`);
                const dbResponse = await fetch(API_URL);
                if (!dbResponse.ok) {
                    throw new Error(`Fetch database gagal: ${dbResponse.statusText}. Pastikan aturan keamanan Firebase mengizinkan akses baca publik.`);
                }
                const dataObject = await dbResponse.json();
                // Convert the Firebase object (keyed by view_uid) into an array
                rawDbData = Object.values(dataObject || {}); 
                isDataFetched = true;
                console.log("Database Firebase berhasil dimuat. Merender halaman...");
                app.processData();
                app.renderInitialHomePage();
            } catch (error) {
                console.error("Error fetching data from Firebase:", error);
                productFeedContainer.html(`<p class="g-loading-text">Gagal memuat data utama dari Firebase.<br><small>${error.message}</small></p>`);
            }
        },

        getLocationNameFromCoords: async (lat, lon) => {
            const functionUrl = `/.netlify/functions/getLocation?lat=${lat}&lon=${lon}`;
            console.log(`Menghubungi Netlify Function: ${functionUrl}`);
            try {
                const response = await fetch(functionUrl);
                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Ralat tidak diketahui dari Netlify Function.');
                }

                if (data.status === 'OK') {
                    let cityName = 'Lokasi Tidak Dikenal';
                    const addressComponents = data.results[0].address_components;
                    const locality = addressComponents.find(c => c.types.includes('locality'));
                    const adminArea2 = addressComponents.find(c => c.types.includes('administrative_area_level_2'));

                    if (locality) {
                        cityName = locality.long_name;
                    } else if (adminArea2) {
                        cityName = adminArea2.long_name.replace(/^(Kota|Kabupaten)\s/i, '');
                    } else {
                        cityName = data.results[0].formatted_address.split(',')[0];
                    }

                    console.log(`Nama lokasi ditemukan: ${cityName}`);
                    return {
                        error: false,
                        name: cityName
                    };
                } else {
                    const errorMessage = data.error_message || `Status: ${data.status}`;
                    console.warn(`Netlify Function melaporkan ralat Geocoding: ${errorMessage}`);
                    return {
                        error: true,
                        message: errorMessage
                    };
                }
            } catch (error) {
                console.error("Gagal menghubungi Netlify Function:", error);
                return {
                    error: true,
                    message: error.message
                };
            }
        },

        processData: () => {
            if (!isDataFetched || !USER_LOCATION) return;
            allProductsEnriched = [];
            // Ensure rawDbData is treated as an array of store objects
            allStoresData = rawDbData
                .filter(s => s.title && s.image) // Filter out any malformed store entries
                .map(store => {
                    // Clean up the store title by removing the appended view_uid
                    // This assumes the format is "Original Title - view_uid"
                    let cleanedStoreTitle = store.title;
                    if (store.view_uid && cleanedStoreTitle.endsWith(` - ${store.view_uid}`)) {
                        cleanedStoreTitle = cleanedStoreTitle.substring(0, cleanedStoreTitle.length - (` - ${store.view_uid}`).length);
                    }

                    // Ensure products is an array, if it's an object from Firebase (keyed by product title)
                    const productsArray = Object.values(store.products || {});

                    const is_open_realtime = store.is_open;
                    const distance = app.calculateDistance(USER_LOCATION.lat, USER_LOCATION.lon, parseFloat(store.origin_lat), parseFloat(store.origin_lng));
                    const totalSold = productsArray.reduce((sum, p) => sum + (p.sold || 0), 0);
                    const fakeStoreRating = store.seller_rating || (3.5 + Math.random() * 1.5).toFixed(1);
                    
                    productsArray.forEach(product => {
                        const fakeProductRating = product.review_rating || (3.5 + Math.random() * 1.5).toFixed(1);
                        allProductsEnriched.push({ ...product,
                            store_name: cleanedStoreTitle, // Use the cleaned title here
                            store_uid: store.view_uid,
                            is_open: is_open_realtime,
                            distance: distance,
                            fake_rating: fakeProductRating,
                        });
                    });
                    return { ...store,
                        title: cleanedStoreTitle, // Update the title in the store object itself for consistent use in rendering functions
                        products: productsArray, // Ensure products is an array for consistent use
                        is_open: is_open_realtime,
                        distance: isNaN(distance) ? Infinity : distance,
                        totalSold,
                        fake_rating: fakeStoreRating
                    };
                });
        },

        showView: (viewId) => {
            $('.g-view').removeClass('active');
            $('#' + viewId).addClass('active');
            feather.replace();
            window.scrollTo(0, 0);
        },
        navigateTo: (viewId) => {
            if (viewId !== viewHistory[viewHistory.length - 1]) viewHistory.push(viewId);
            app.showView(viewId);
            loadMoreContainer.hide();
            searchSuggestionsContainer.hide();
        },
        navigateBack: () => {
            if (viewHistory.length > 1) {
                viewHistory.pop();
                const previousView = viewHistory[viewHistory.length - 1];
                if (previousView === 'main-feed-view') {
                    searchInput.val('');
                    searchResultsList.html('<p class="g-loading-text">Mencari...</p>');
                }
                app.showView(previousView);
                if (previousView === 'main-feed-view') {
                    app.updateLoadMoreButton();
                }
            }
        },
        renderInitialHomePage: () => {
            app.renderHomepageScrollers();
            app.renderCategories();
            app.renderFeeds(false);
            feather.replace();
        },
        renderHomepageScrollers: () => {
            const scrollerContainer = $('#homepage-scrollers').html('');
            const nearestStores = [...allStoresData].sort((a, b) => a.distance - b.distance).slice(0, 6);
            let nearestStoresHtml = `<div class="g-scroller-wrapper"><h2>📍 Toko Terdekat di ${USER_LOCATION.name}</h2><div class="g-scroller">`;
            nearestStores.forEach(item => {
                nearestStoresHtml += app.renderLandscapeStoreCard(item);
            });
            nearestStoresHtml += '</div></div>';
            scrollerContainer.append(nearestStoresHtml);

            const uniqueStoreProducts = {};
            [...allProductsEnriched].sort((a, b) => (b.sold || 0) - (a.sold || 0)).forEach(p => {
                if (!uniqueStoreProducts[p.store_uid]) uniqueStoreProducts[p.store_uid] = p;
            });
            const bestSellingProducts = Object.values(uniqueStoreProducts).sort((a, b) => (b.sold || 0) - (a.sold || 0)).slice(0, 9);

            let bestSellingHtml = `<div class="g-scroller-wrapper"><h2>🔥 Produk Terlaris</h2><div class="g-scroller three-col">`;
            bestSellingProducts.forEach(product => {
                bestSellingHtml += app.renderSmallProductCard(product);
            });
            bestSellingHtml += '</div></div>';
            scrollerContainer.append(bestSellingHtml);
        },
        renderCategories: () => {
            const container = $('#category-filter-container').html('');
            for (const catName in smartCategories) {
                const cat = smartCategories[catName];
                container.append(`<div class="cat-item ${catName === 'Semua' ? 'active' : ''}" data-category="${catName}"><div class="cat-icon-wrapper"><i data-feather="${cat.icon}"></i></div><span class="cat-name">${catName}</span></div>`);
            }
        },
        renderFeeds: (append = false) => {
            if (!append) {
                app.sortAndFilterData();
                displayedProductCount = 0;
                displayedStoreCount = 0;
                productFeedContainer.html('');
                storeListContainer.html('');
            }
            if (activeViewType === 'produk') app.renderProductFeed(append);
            else app.renderStoreFeed(append);
            app.updateLoadMoreButton();
            feather.replace();
        },
        sortAndFilterData: () => {
            let currentProducts = [...allProductsEnriched];
            let currentStores = [...allStoresData];
            if (activeSort === 'buka24jam') {
                currentStores = allStoresData.filter(store => store.is_open);
                const openStoreUids = new Set(currentStores.map(s => s.view_uid));
                currentProducts = allProductsEnriched.filter(product => openStoreUids.has(product.store_uid));
            }
            if (activeProductCategory !== 'Semua') {
                currentProducts = currentProducts.filter(product => {
                    const keywords = smartCategories[activeProductCategory]?.keywords || [];
                    return keywords.some(kw => product.title.toLowerCase().includes(kw));
                });
            }
            sortedProducts = [...currentProducts];
            sortedStores = [...currentStores];
            const sortFunction = (a, b, isStore = false) => {
                if (activeSort === 'terdekat') return a.distance - b.distance;
                if (activeSort === 'terlaris') return (isStore ? b.totalSold : (b.sold || 0)) - (isStore ? a.totalSold : (a.sold || 0));
                if (activeSort === 'rating') return (b.fake_rating || 0) - (a.fake_rating || 0);
                if (activeSort === 'termurah') {
                    const priceA = isStore ? (a.products.length > 0 ? Math.min(...a.products.map(p => p.price)) : Infinity) : a.price;
                    const priceB = isStore ? (b.products.length > 0 ? Math.min(...b.products.map(p => p.price)) : Infinity) : b.price;
                    return priceA - priceB;
                }
                return 0;
            };
            sortedProducts.sort((a, b) => sortFunction(a, b, false));
            sortedStores.sort((a, b) => sortFunction(a, b, true));
        },
        renderStoreFeed: (append) => {
            const container = storeListContainer;
            if (!append) container.html('');
            const itemsToShow = sortedStores.slice(displayedStoreCount, displayedStoreCount + ITEMS_PER_PAGE);
            if (!append && itemsToShow.length === 0) container.html(`<p class="g-loading-text">Tidak ada toko yang sesuai.</p>`);
            itemsToShow.forEach(item => container.append(app.renderStoreCard(item)));
            displayedStoreCount += itemsToShow.length;
        },
        renderProductFeed: (append) => {
            const container = productFeedContainer;
            if (!append) container.html('');
            const itemsToShow = sortedProducts.slice(displayedProductCount, displayedProductCount + ITEMS_PER_PAGE);
            if (!append && itemsToShow.length === 0) container.html(`<p class="g-loading-text">Tidak ada produk yang sesuai.</p>`);
            itemsToShow.forEach(product => container.append(app.renderProductCard(product)));
            displayedProductCount += itemsToShow.length;
        },
        renderLandscapeStoreCard: (item) => `
        <div class="landscape-store-card store-card" data-id="${item.view_uid}">
            <img class="image-wrapper" src="${IMAGE_BASE_URL}${item.image}" alt="${item.title}" loading="lazy" onerror="this.src='https://placehold.co/280x120/e9e9e9/757575?text=Gagal+Muat'">
            <div class="content">
                <div class="title-status"><h3 class="title">${item.title}</h3><span class="status-badge ${item.is_open ? 'open' : 'closed'}">${item.is_open ? 'Buka' : 'Tutup'}</span></div>
                <p class="address">${item.origin_address || 'Alamat tidak tersedia'}</p>
                <div class="details"><div class="rating-stars">${app.generateRatingStars(item.fake_rating, true)}</div> &bull; <span>${item.distance.toFixed(1)} km</span></div>
            </div>
        </div>`,
        renderProductCard: (product) => {
            const statusText = product.is_open ? 'Buka' : 'Tutup';
            const statusClass = product.is_open ? 'open' : 'closed';
            // Menambahkan kelas untuk menonaktifkan klik jika toko tutup
            const disableClickClass = product.is_open ? '' : 'no-click';
            const addBtnDisabled = product.is_open ? '' : 'disabled'; // Untuk tombol tambah

            return `<div class="prod-card ${disableClickClass}">
                <a href="action://p/${product.view_uid}" class="${disableClickClass}">
                    <div class="image-wrapper"><img src="${IMAGE_BASE_URL}${product.image}" alt="${product.title}" loading="lazy" onerror="this.src='https://placehold.co/180x180/e9e9e9/757575?text=Gagal+Muat'"></div>
                    <div class="content">
                        <h4 class="title">${product.title}</h4>
                        <div class="store-info"><span>${product.store_name} &bull; ${product.distance.toFixed(1)} km</span></div>
                        <div class="bottom-row">
                            <div class="rating-stars">${app.generateRatingStars(product.fake_rating, true)}</div>
                            <span class="status-badge ${statusClass}">${statusText}</span>
                        </div>
                        <p class="price" style="margin-top: 6px;">Rp ${product.price.toLocaleString('id-ID')}</p>
                    </div>
                </a>
                <button class="add-btn" ${addBtnDisabled}><i data-feather="plus"></i></button>
            </div>`;
        },
        renderSmallProductCard: (product) => `
        <div class="prod-card-small">
            <a href="action://p/${product.view_uid}">
                <div class="image-wrapper"><img src="${IMAGE_BASE_URL}${product.image}" alt="${product.title}" loading="lazy" onerror="this.src='https://placehold.co/120x120/e9e9e9/757575?text=Gagal+Muat'"></div>
                <div class="content">
                    <h4 class="title">${product.title}</h4>
                    <div class="bottom-row">
                        <div class="rating-stars">${app.generateRatingStars(product.fake_rating)}</div>
                        <p class="price">Rp ${product.price.toLocaleString('id-ID')}</p>
                    </div>
                </div>
            </a>
            <button class="add-btn"><i data-feather="plus" style="width:18px; height:18px;"></i></button>
        </div>`,
        renderProductCard: (product) => {
            const statusText = product.is_open ? 'Buka' : 'Tutup';
            const statusClass = product.is_open ? 'open' : 'closed';
            return `<div class="prod-card">
                <a href="action://p/${product.view_uid}">
                    <div class="image-wrapper"><img src="${IMAGE_BASE_URL}${product.image}" alt="${product.title}" loading="lazy" onerror="this.src='https://placehold.co/180x180/e9e9e9/757575?text=Gagal+Muat'"></div>
                    <div class="content">
                        <h4 class="title">${product.title}</h4>
                        <div class="store-info"><span>${product.store_name} &bull; ${product.distance.toFixed(1)} km</span></div>
                        <div class="bottom-row">
                            <div class="rating-stars">${app.generateRatingStars(product.fake_rating, true)}</div>
                            <span class="status-badge ${statusClass}">${statusText}</span>
                        </div>
                        <p class="price" style="margin-top: 6px;">Rp ${product.price.toLocaleString('id-ID')}</p>
                    </div>
                </a>
                <button class="add-btn"><i data-feather="plus"></i></button>
            </div>`;
        },
        updateLoadMoreButton: () => {
            const hasMore = (activeViewType === 'produk' && displayedProductCount < sortedProducts.length) || (activeViewType === 'toko' && displayedStoreCount < sortedStores.length);
            loadMoreContainer.toggle(hasMore);
        },
        renderStoreDetail: (storeId) => {
            const storeData = allStoresData.find(s => s.view_uid === storeId);
            if (!storeData) return;
            const store = storeData;
            const container = $('#store-detail-content').html('');
            $('#store-detail-title').text(store.title);
            let headerHtml = `<div class="sd-header">
                <img src="${IMAGE_BASE_URL}${store.image}" class="sd-header-bg" alt="" onerror="this.style.display='none'"><div class="sd-header-content">
                <img src="${IMAGE_BASE_URL}${store.image}" class="sd-logo" alt="${store.title}" onerror="this.src='https://placehold.co/80x80/e9e9e9/757575?text=Gagal+Muat'"><div class="sd-info">
                <h1>${store.title}</h1><p>${store.origin_address || 'Alamat tidak tersedia'}</p>
                <div class="sd-stats"><div class="rating-stars">${app.generateRatingStars(storeData.fake_rating, true)}</div><span>&bull;</span><span>${storeData.distance.toFixed(1)} km</span><span>&bull;</span><span class="status-badge ${store.is_open ? 'open' : 'closed'}">${store.is_open ? 'Buka' : 'Tutup'}</span></div>
                </div></div></div>`;
            let bodyHtml = `<div class="sd-body">`;
            if (storeData.products?.length > 0) {
                const bestSelling = [...storeData.products].sort((a, b) => (b.sold || 0) - (a.sold || 0)).slice(0, 5);
                if (bestSelling.length > 0) {
                    bodyHtml += `<div class="sd-section sd-product-slider"><div class="sd-section-header"><h2>👍 Paling Laris</h2></div><div class="g-scroller">`;
                    bestSelling.forEach(product => {
                        bodyHtml += app.renderStoreDetailBestSellingCard(product);
                    });
                    bodyHtml += `</div></div>`;
                }
                bodyHtml += `<div class="sd-section"><div class="sd-section-header"><h2>Semua Menu</h2><div class="sd-view-toggle"><button class="view-toggle-btn active" data-view="grid"><i data-feather="grid"></i></button><button class="view-toggle-btn" data-view="list"><i data-feather="list"></i></button></div></div><div id="sd-full-menu-list" class="grid-view">`;
                storeData.products.forEach(product => {
                    bodyHtml += app.renderStoreMenuItem(product);
                });
                bodyHtml += `</div></div>`;
            }
            bodyHtml += `</div>`;
            container.html(headerHtml + bodyHtml);
            app.navigateTo('store-detail-view');
        },
        renderStoreDetailBestSellingCard: (product) => `
        <div class="sd-prod-card"><a href="action://p/${product.view_uid}">
            <div class="image-wrapper"><img src="${IMAGE_BASE_URL}${product.image}" alt="${product.title}" onerror="this.src='https://placehold.co/180x180/e9e9e9/757575?text=Gagal+Muat'"></div>
            <div class="content"><h4 class="title">${product.title}</h4><div class="bottom-row"><p class="price">Rp ${product.price.toLocaleString('id-ID')}</p><button class="add-btn"><i data-feather="plus" style="width:18px;height:18px;"></i></button></div></div>
        </a></div>`,
        renderStoreMenuItem: (product) => `
        <div class="sd-menu-item-card" data-id="${product.view_uid}">
            <a href="action://p/${product.view_uid}">
                <div class="image-wrapper"><img src="${IMAGE_BASE_URL}${product.image}" alt="${product.title}" onerror="this.src='https://placehold.co/90x90/e9e9e9/757575?text=Gagal+Muat'"></div>
                <div class="content"><h4 class="title">${product.title}</h4><p class="price">Rp ${product.price.toLocaleString('id-ID')}</p></div>
            </a>
            <button class="add-btn"><i data-feather="plus" style="width:20px; height:20px;"></i></button>
        </div>`,
        handleSearch: (query, executeSearch = false) => {
            clearTimeout(searchDebounce);
            if (!query) {
                searchSuggestionsContainer.hide();
                if (executeSearch && viewHistory[viewHistory.length - 1] === 'search-results-view') {
                    app.navigateBack();
                }
                return;
            }
            if (executeSearch) {
                searchResults = allProductsEnriched.filter(p => p.title.toLowerCase().includes(query.toLowerCase()));
                app.sortAndRenderSearchResults();
                if (viewHistory[viewHistory.length - 1] !== 'search-results-view') {
                    app.navigateTo('search-results-view');
                }
                searchSuggestionsContainer.hide();
            } else {
                app.showSearchSuggestions(query);
            }
        },
        showSearchSuggestions: (query) => {
            const suggestions = searchSuggestionsData.filter(s => s.toLowerCase().includes(query.toLowerCase()));
            searchSuggestionsContainer.html('');
            if (suggestions.length > 0) {
                suggestions.forEach(s => {
                    const highlighted = s.replace(new RegExp(query, "gi"), (match) => `<strong>${match}</strong>`);
                    searchSuggestionsContainer.append(`<div class="suggestion-item" data-suggestion="${s}">${highlighted}</div>`);
                });
                searchSuggestionsContainer.show();
            } else {
                searchSuggestionsContainer.hide();
            }
        },
        sortAndRenderSearchResults: () => {
            let finalResults = [...searchResults];
            if (activeSearchSort === 'buka24jam') finalResults = finalResults.filter(p => p.is_open);
            else if (activeSearchSort === 'termurah') finalResults.sort((a, b) => a.price - b.price);
            else if (activeSearchSort === 'terlaris') finalResults.sort((a, b) => (b.sold || 0) - (a.sold || 0));
            else finalResults.sort((a, b) => a.distance - b.distance);
            app.renderSearchResults(finalResults);
        },
        renderSearchResults: (results) => {
            searchResultsList.html('');
            if (results.length === 0) {
                searchResultsList.html('<p class="g-loading-text">Produk tidak ditemukan.</p>');
                return;
            }
            results.forEach(product => {
                const statusText = product.is_open ? 'Buka' : 'Tutup';
                const statusClass = product.is_open ? 'open' : 'closed';
                searchResultsList.append(`<div class="search-item-card">
                    <span class="status-badge ${statusClass}">${statusText}</span>
                    <div class="image-wrapper"><img src="${IMAGE_BASE_URL}${product.image}" alt="${product.title}" loading="lazy" onerror="this.src='https://placehold.co/90x90/e9e9e9/757575?text=Gagal+Muat'"></div>
                    <div class="info">
                        <h3 class="title">${product.title}</h3><p class="price">Rp ${product.price.toLocaleString('id-ID')}</p>
                        <div class="store-info"><i data-feather="home" style="width:14px; height:14px;"></i><span>${product.store_name}</span></div>
                        <div class="bottom-row"><div class="rating-stars">${app.generateRatingStars(product.fake_rating, true)} &bull; ${product.distance.toFixed(1)} km</div><a href="action://p/${product.view_uid}"><button class="order-btn">Order</button></a></div>
                    </div>
                </div>`);
            });
            feather.replace();
        },
        calculateDistance: (lat1, lon1, lat2, lon2) => {
            if ([lat1, lon1, lat2, lon2].some(v => isNaN(v) || v === null)) return Infinity;
            const R = 6371;
            const dLat = (lat2 - lat1) * Math.PI / 180,
                dLon = (lon2 - lon1) * Math.PI / 180;
            const a = 0.5 - Math.cos(dLat) / 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * (1 - Math.cos(dLon)) / 2;
            return R * 2 * Math.asin(Math.sqrt(a));
        },
        generateRatingStars: (rating, withIcon = false) => {
            let starsHtml = ``;
            if (withIcon) starsHtml += `<i data-feather="star" class="feather-star"></i>`;
            starsHtml += `<span class="rating-text">${rating}</span>`;
            return starsHtml;
        },

        initialize: () => {
            // Event Handlers
            $('.g-toggle-btn').on('click', function() {
                activeViewType = $(this).data('view');
                $('.g-toggle-btn').removeClass('active');
                $(this).addClass('active');
                $('.g-feed-container').removeClass('active');
                $('#' + (activeViewType === 'produk' ? 'product-feed-container' : 'store-list-container')).addClass('active');
                categoryScrollerWrapper.toggle(activeViewType === 'produk');
                app.renderFeeds(false);
            });
            $('#main-sort-buttons').on('click', '.g-sort-btn', function() {
                activeSort = $(this).data('sort');
                $('#main-sort-buttons .g-sort-btn').removeClass('active');
                $(this).addClass('active');
                app.renderFeeds(false);
            });
            $('#category-filter-container').on('click', '.cat-item', function() {
                activeProductCategory = $(this).data('category');
                $('#category-filter-container .active').removeClass('active');
                $(this).addClass('active');
                app.renderFeeds(false);
            });
            searchInput.on('input', function() {
                clearTimeout(searchDebounce);
                const query = $(this).val();
                if (query.length < 2) {
                    searchSuggestionsContainer.hide();
                    return;
                }
                searchDebounce = setTimeout(() => {
                    app.handleSearch(query, false);
                }, 300);
            });
            searchInput.on('keypress', function(e) {
                if (e.which == 13) {
                    e.preventDefault();
                    app.handleSearch($(this).val(), true);
                }
            });
            searchSuggestionsContainer.on('click', '.suggestion-item', function() {
                const suggestion = $(this).data('suggestion');
                searchInput.val(suggestion);
                app.handleSearch(suggestion, true);
            });
            $('#search-filters').on('click', '.g-sort-btn', function() {
                activeSearchSort = $(this).data('sort');
                $('#search-filters .g-sort-btn').removeClass('active');
                $(this).addClass('active');
                app.sortAndRenderSearchResults();
            });
            mainContainer.on('click', '.view-toggle-btn', function() {
                const view = $(this).data('view');
                const container = $('#sd-full-menu-list');
                $('.view-toggle-btn').removeClass('active');
                $(this).addClass('active');
                container.removeClass('grid-view list-view').addClass(view + '-view');
                feather.replace();
            });
            loadMoreBtn.on('click', () => app.renderFeeds(true));
            mainContainer.on('click', '.store-card', function() {
                app.renderStoreDetail($(this).data('id'));
            });
            mainContainer.on('click', '.back-button', app.navigateBack);
            $(document).on('click', function(e) {
                if (!$(e.target).closest('.search-bar-wrapper').length) {
                    searchSuggestionsContainer.hide();
                }
            });
            editLocationBtn.on('click', () => {
                locationInputAddress.val(USER_LOCATION.name);
                locationModal.addClass('active');
                feather.replace();
            });

            const closeModal = () => locationModal.removeClass('active');
            closeLocationModalBtn.on('click', closeModal);
            locationModal.on('click', function(e) {
                if ($(e.target).is(locationModal)) {
                    closeModal();
                }
            });
            saveLocationBtn.on('click', () => {
                const newAddress = locationInputAddress.val().trim();
                if (newAddress && newAddress !== USER_LOCATION.name) {
                    locationText.text("Memperbarui lokasi...");
                    console.log(`Alamat diubah secara manual ke: "${newAddress}"`);
                    console.warn("PERINGATAN: Ini adalah simulasi. Di aplikasi nyata, Anda memerlukan API Geocoding untuk mengubah alamat ini menjadi koordinat (lat/lon) baru. Jarak tidak akan dihitung ulang secara akurat sampai koordinat diperbarui.");
                    USER_LOCATION.name = newAddress;
                    locationText.text(newAddress);
                    app.renderHomepageScrollers();
                    feather.replace();
                }
                closeModal();
            });
            
            // App Initialization
            const startApp = async () => {
                locationText.text("Mendeteksi Lokasi anda...");
                productFeedContainer.html(`<p class="g-loading-text">Memuat produk...</p>`); // Reset loading state

                // --- Firebase SDK initialization removed as per user request for direct .json fetch ---
                // If you want realtime updates or stricter security, uncomment the Firebase SDK imports
                // and the Firebase initialization/authentication block from the previous version.

                if (navigator.geolocation) {
                    navigator.geolocation.getCurrentPosition(
                        async (position) => {
                            const {
                                latitude,
                                longitude
                            } = position.coords;
                            console.log(`Koordinat dari browser: Lat=${latitude}, Lng=${longitude}`);
                            locationText.text("Mendapatkan nama lokasi...");

                            const result = await app.getLocationNameFromCoords(latitude, longitude);

                            if (result && !result.error) {
                                locationText.text(result.name);
                                editLocationBtn.show();
                                USER_LOCATION = {
                                    name: result.name,
                                    lat: latitude,
                                    lon: longitude
                                };
                                // Fetch data from Firebase via direct .json URL
                                await app.fetchData(); 
                            } else {
                                const errorMsg = "Gagal mendapatkan nama lokasi dari koordinat.";
                                const detailMsg = result ? result.message : "Tidak ada respons dari Netlify Function.";
                                console.error(errorMsg, detailMsg);
                                locationText.text("Nama Lokasi Tidak Ditemukan");
                                productFeedContainer.html(`<p class="g-loading-text">${errorMsg}<br><small>Sebab: ${detailMsg}</small></p>`);
                            }
                        },
                        (error) => {
                            let errorMsg = "Gagal mendapatkan lokasi otomatis.";
                            switch (error.code) {
                                case error.PERMISSION_DENIED:
                                    errorMsg = "Anda menolak izin untuk mengakses lokasi.";
                                    break;
                                case error.POSITION_UNAVAILABLE:
                                    errorMsg = "Informasi lokasi tidak tersedia.";
                                    break;
                                case error.TIMEOUT:
                                    errorMsg = "Waktu permintaan lokasi habis.";
                                    break;
                                case error.UNKNOWN_ERROR:
                                    errorMsg = "Terjadi kesalahan yang tidak diketahui.";
                                    break;
                            }
                            console.error(errorMsg);
                            locationText.text("Lokasi Otomatis Gagal");
                            productFeedContainer.html(`<p class="g-loading-text">${errorMsg}<br><small>Sila berikan izin akses lokasi pada browser Anda dan muat ulang halaman.</small></p>`);
                        }
                    );
                } else {
                    const errorMsg = "Geolocation tidak didukung oleh browser ini.";
                    console.error(errorMsg);
                    locationText.text("Geolocation Tidak Didukung");
                    productFeedContainer.html(`<p class="g-loading-text">${errorMsg}</p>`);
                }
            };
            startApp();
        }
    };
    app.initialize();
});
