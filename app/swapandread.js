//@ts-check
"use strict";
const parseString = require('xml2js').parseString
      , https = require("https");

const urlBase = "https://www.goodreads.com/search/index.xml?key=" + process.env.GOODREADS_KEY + "&q=";

const isLoggedIn = function(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    req.flash("loginMessage", "Please log in or sign up to continue.")
    res.redirect("/login");
}

module.exports = function(app, db, passport) {

    /* GET routes */
    // Main page
    app.get("/", isLoggedIn, (req, res) => {
        const user = req.user;
        db.collection("books").find({}, {_id: 0}).toArray((err, results) => {
            if (err) {
                console.error(err);
                return // Maybe do something else here?!?
            }
            return res.render("index", {results: results, user: user});
        })
    })
    // Log in/sign up
    app.get("/login", (req, res) => {
        let loginMessage = req.flash("loginMessage");
        if (loginMessage.length === 0) loginMessage = false;
        return res.render("login", {loginMessage: loginMessage});
    })
    // Profile page
    app.get("/profile", isLoggedIn, (req, res) => {
        const userID = req.user._id;
        const searchTitle = req.session.searchTitle || false;
        const searchResults = req.session.searchResults || false;
        // Reset search results and title so that they don't get sticky:
        req.session.searchTitle = false;
        req.session.searchResults = false;
        let profileMessage = req.flash("profileMessage");
        if (profileMessage.length === 0) profileMessage = false;
        if (req.session.userBooks) {
            // console.log(req.session.userBooks)
            return res.render("profile", {
                user: req.user
                , books: req.session.userBooks 
                , profileMsg: profileMessage
                , searchTitle: searchTitle
                , searchResults: searchResults
            });
        }
        console.log("No books in session. Querying DB")
        db.collection("books").find({
            users: { 
                $in: [userID] 
            }
        })
        .project({ 
            // Rethink this bit. Do I want to leave out any fields?
        })
        .toArray((err, books) => {
            if (err) {
                console.error(err)
                return;
            }
            req.session.userBooks = books; // Make sure that this does update the session!
            return res.render("profile", {
                username: req.user.username
                , books: req.session.userBooks 
                , profileMsg: profileMessage
                , searchTitle: searchTitle
                , searchResults: searchResults
            });
        });
    })
    // Dashboard to view/manage requests
    app.get("requests", isLoggedIn, (req, res) => {
        let requestMessage = req.flash("requestMessage");
        if (requestMessage.legth === 0) requestMessage = false;
        const userID = req.user._id;
        // TODO: Rather than querying the DB each time this page is rendered save the results in session
        // and update session when there's a change to requests or messages maybe?
        // Also; when this has been implemented session should get updated using web sockets when new requests
        // come in or requests are removed from the system.
        const incoming = req.session.incoming || false;
        const outgoing = req.session.outgoing || false;
        const messages = req.session.messages || false;
        if (req.session.incoming || req.session.outgoing || req.session.messages) {
            return res.render("bookRequests", {
                requestMessage: requestMessage
                , incoming: incoming
                , outgoing: outgoing
                , messages: messages
            });
        }
        console.log("No request history in session. Querying DB")
        db.collection("bookRequests").find(
            {$or: [ {fromID: userID}, {toID: userID} ]}
        ).toArray((err, documents) => {
            if (err) {
                console.error(err);
                return;
            }
            let incoming = [];
            let outgoing = [];
            documents.forEach((doc) => {
                if (doc.toID === userID) {
                    incoming.push(doc);
                }
                outgoing.push(doc);
            });
            db.collection("bookMessages").find(
                {to: userID}
            ).toArray((err, messages) => {
                if (err) {
                    console.error(err);
                    return;
                }
                // TODO: Does this actually do the trick?!?
                req.session.incoming = incoming;
                req.session.outgoing = outgoing;
                req.session.messages = messages;
                return res.render("bookRequests", {
                    requestMessage: requestMessage
                    , incoming: incoming
                    , outgoing: outgoing
                    , messages: messages
                });
            });
        });
    })

    app.get("/logout", (req, res) => {
        req.logout();
        res.redirect("/");
    })

    /* POST routes */
    // Log in
    app.post("/login", function(req, res) {
        passport.authenticate("local-login", function(err, user, info){
            if (err) {
                console.error(err);
                return res.redurect("login", {loginMessage: err});
            }
            if (!user) {
                return res.render("login", {loginMessage: req.flash("loginMessage")});
            }
            req.login(user, function(err){
                if (err) {
                    return res.render("login", {loginMessage: err});
                }
                return res.redirect("/");
            })
        })(req, res)
    });
    // Sign up
    app.post("/signup", function(req, res) {
        passport.authenticate("local-signup", function(err, user, info) {
            if (err) {
                return res.render("login", {loginMessage: err});
            }
            if (!user) {
                return res.render("login", {loginMessage: req.flash("loginMessage")});
            }
            req.login(user, function(err) {
                if(err) {
                    return res.render("login", {loginMessage: err});
                }
                return res.redirect("/");
            })
        })(req, res)
    });
    // Edit profile
    app.post("/editProfile", isLoggedIn, (req, res) => {
        const fullName = req.body.fullName;
        const city = req.body.city;
        const countryOrState = req.body.countryOrState;
        db.collection("bookUsers").findOneAndUpdate(
            {_id: req.user._id}
            , {$set: 
                {
                    profile: {
                        fullName: fullName
                        , city: city
                        , countryOrState: countryOrState
                    }
                }
            }
            , {
                returnOriginal: false
            }
            , (err, response) => {
                if (err) {
                    console.error(err);
                    return;
                }
                req.flash("profileMessage", "Your changes have been successfully saved.");
                return res.redirect("profile");
            }
        )
    })
    // Search for books in goodreads to add to collection.
    app.post("/search", (req, res) => {
        const query = urlBase + req.body.title;
        https.get(query, (response) => {
            if (response.statusCode == 200) {
                let body = "";
                response.on("data", (chunk) => {
                    body += chunk;
                });
                response.on("end", () => {
                    parseString(body, (err, obj) => {
                        if (err) {return console.error(err)}
                        if (obj.GoodreadsResponse.search[0]["total-results"][0] == 0) {
                            return res.render("search", {title: 'No results found for "' + req.body.title + '"', results: []})
                        }
                        const topResults = obj.GoodreadsResponse.search[0].results[0].work.slice(0, 10); //show top 10 results!
                        const searchResults = topResults.map((topResult) => {
                            const pubYear = topResult.original_publication_year[0]._;
                            const title = topResult.best_book[0].title[0]
                            const author = topResult.best_book[0].author[0].name[0];
                            const imgUrl = topResult.best_book[0].image_url[0];
                            const id = topResult.id[0]._;
                            return {
                                _id: id
                                , pubYear:pubYear
                                , title: title
                                , author: author 
                                , imgUrl: imgUrl 
                            }
                        });
                        req.session.searchTitle = req.body.title;
                        req.session.searchResults = searchResults;
                        return res.redirect("profile");
                        // return res.render("search", {title: 'Top results for "' + req.body.title + '"', results: searchResults});
                    });
                });
            }
        })
    })
    // Add book to collection (NOT through trade!)
    app.post("/addbook", isLoggedIn, (req, res) => {
        const userID = req.user._id;
        const book = JSON.parse(req.body.book);
        db.collection("books").findOneAndUpdate(
            {_id: book.id}
            , {
                $setOnInsert: {
                    _id: book.id
                    , title: book.title
                    , author: book.author
                    , pubYear: book.pubYear
                    , imgUrl: book.imgUrl
                },
                $addToSet: {
                    users: req.user._id
                }
            }
            , {
                upsert: true
                , returnOriginal: false
            }
        , (err, response)=> {
            if (err) {
                console.error(err);
                return;
            }
            req.session.userBooks.push(book); // TODO: Shall we really keep the books in session?!?
            return res.redirect("profile");
        })
    })
    // Remove book from collection (NOT through trade!)
    app.post("/removebook", isLoggedIn, (req, res) => {
        const userID = req.user._id;
        const bookID = req.body.bookID;
        console.log("Will remove " + bookID)
        db.collection("books").findOneAndUpdate(
            {_id: bookID}
            , {
                $pull: {
                    users: userID
                }
            }
            , {
                returnOriginal: false
                , upsert: false
            }
            , (err, response) => {
                if (err) {
                    console.error(err);
                    return;
                }
                const ind = req.session.userBooks.findIndex((book)=>{return book._id == bookID});
                console.log("Removing " + req.session.userBooks[ind].title + " at position " + ind)
                db.collection("books").deleteOne({_id: bookID, users: {$size: 0}}); // Delete books if no user has them anymore.
                req.session.userBooks.splice(ind, 1);
                return res.redirect("profile");
            }
        )
    })
    // Request a book
    app.post("/requestbook", isLoggedIn, (req, res) => {
        /*
        Are we going to send the request to all users who have the book,
        only the first user or let the user pick whom to ask?
        I go for the SECOND option for now. Rethink & change if necessary!
        */
        const fromUser = req.user.username;
        const fromID = req.user._id;
        const toID = req.body.book.users[0]; // This is the _id of the User NOT the username!
        const bookTitle = req.body.bookTitle; // TODO: Would it be sufficient to save only the book id in the db maybe?
        const bookID = req.body.bookID;
        db.collection("bookRequests").insertOne(
            {
                fromUser: fromUser
                , fromID: fromID
                , toID: toID
                , bookTitle: bookTitle
                , bookID: bookID
            }
            , (err, response) => {
                if (err) {
                    console.error(err);
                    return;
                }
                // TODO: alert online users of the new request if they are among the recipients here!
                req.flash("requestMessage", "You have requested " + bookTitle + ".")
                return res.redirect("requests")
            }
        )
    })
    // Cancel a request
    app.post("/cancelrequest", isLoggedIn, (req, res) => {
        const requestID = req.body.requestID;
        db.collection("bookRequests").findOneAndDelete(
            {_id: requestID}
            , (err, response) => {
                req.flash("requestMessage", "You have cancelled your request.")
                res.redirect("requests")
            }
        )
    })
    // Accept a request
    app.post("/accept", isLoggedIn, (req, res) => {
        const bookID = req.body.bookID;
        const bookTitle = req.body.bookTitle;
        const fromID = req.body.fromID;
        const fromUser = req.body.fromUser;
        const requestID = req.body.requestID;
        db.collection("bookRequests").findOneAndDelete({_id: requestID}, (err, response) => {
            if (err) {
                console.error(err);
                return;
            }
            db.collection("bookMessages").insertOne(
                {
                    to: fromID
                    , message: "User " + req.user.username + " has accepted your request for " + bookTitle
                }
                , (err, response) => {
                    db.collection("books").findOneAndUpdate(
                        {_id: bookID}
                        , {
                            $pull: {
                                users: req.user._id
                            }
                            , $addToSet: {
                                users: fromID
                            }
                        }
                        , {
                            returnOriginal: false
                        }
                        , (err, response) => {
                            if (err) {
                                console.error(err);
                                return;
                            }
                            req.flash("requestMessage", "You have accepted " + fromUser + "'s " + " request for " + bookTitle)
                            res.redirect("requests");
                        }
                    )
                }
            );
        });              
    })
    // Reject a request
    app.post("/reject", isLoggedIn, (req, res) => {
        const userID = req.user._id;
        const requestID = req.body.requestID;
        const bookTitle = req.body.bookTitle;
        const fromID = req.body.fromID; // This is the id of the user who sent the request!
        db.collection("bookRequests").findOneAndDelete(
            {_id: requestID}
            , (err, response) => {
                if (err) {
                    console.error(err);
                    return;
                }
                db.collection("bookMessages").insertOne(
                    {
                        to: fromID
                        , message: userID + " has rejected your request for " + bookTitle + "."
                    }
                )
            }
        )
        // TODO: Delete the request altogether!
        // Maybe it'll be simpler to send the request to only one user in this sense.
    })
    // Delete message from inbox
    app.post("/deletemessages", isLoggedIn, (req, res) => {
        const messageIDs = req.body.messageIDs;
        db.collection("bookMessages").deleteMany(
            {
                _id: { $in: messageIDs }
            }
            , (err, response) => {
                if (err) {
                    console.error(err);
                    return;
                }
                req.flash("requestMessage", messageIDs.length + " messages successfully deleted.");
                res.redirect("requests");
            }
        )
    })
}